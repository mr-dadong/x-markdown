import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import {
    authorizeDirectory,
    authorizeDocument,
    isPathInside,
} from "./pathAccess";

// 压缩包工作区：把 .zip 解压到临时目录后按普通文档编辑，
// 保存成功再把工作区内容重新打包回原始 zip。

// 单个压缩包解压后的总大小上限（512MB），防止压缩炸弹撑爆磁盘与内存。
const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
// 所有压缩包工作区共用的根目录（位于系统临时目录下）。
const WORKSPACES_ROOT_NAME = "xmd-zip-workspaces";
// 工作区清单文件名（点前缀，回写 zip 时会被排除）。
// 记录来源 zip 的路径、mtime 与脏标记，用于判断工作区是否新鲜、以及按时间清理时跳过未写回的修改。
const MANIFEST_NAME = ".xmd-zip-manifest.json";
// 启动时清理多少天前遗留的工作区（上次异常退出没走正常清理流程的兜底）。
const STALE_WORKSPACE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// 压缩包内会被打开为文档的扩展名，与打开对话框的过滤器保持一致。
const OPENABLE_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export interface OpenDocumentData {
    filePath: string;
    content: string;
    modifiedTime: number;
}

// 清单结构：写在工作区根目录，打开时判新鲜、启动清理时判脏都读它。
interface ZipWorkspaceManifest {
    zipPath: string;
    zipMtimeMs: number;
    dirty: boolean;
}

interface ZipWorkspace {
    zipPath: string;
    // 最近一次成功回写（或解压）时 zip 的 mtime，写清单时直接用。
    zipMtimeMs: number;
    // 回写 zip 失败时置为 true：此时工作区里有未写回压缩包的修改，禁止清理。
    dirty: boolean;
}

// 已创建的工作区登记表：key 为工作区目录，保存流程与清理流程都靠它找来源 zip。
const zipWorkspaces = new Map<string, ZipWorkspace>();

// 用 zip 绝对路径的哈希做目录名：同一 zip 固定映射到同一工作区，实现按路径去重。
function workspaceDirForZip(zipPath: string): string {
    const hash = createHash("sha256")
        .update(path.resolve(zipPath))
        .digest("hex")
        .slice(0, 16);
    return path.join(os.tmpdir(), WORKSPACES_ROOT_NAME, `zip-${hash}`);
}

// 读取工作区清单；缺失或损坏时返回 null（调用方按「需要重新解压」处理）。
async function readManifest(
    workspaceDir: string,
): Promise<ZipWorkspaceManifest | null> {
    try {
        const parsed = JSON.parse(
            await fs.promises.readFile(path.join(workspaceDir, MANIFEST_NAME), "utf-8"),
        ) as Partial<ZipWorkspaceManifest>;
        if (typeof parsed.zipPath !== "string" || typeof parsed.zipMtimeMs !== "number") {
            return null;
        }
        return { zipPath: parsed.zipPath, zipMtimeMs: parsed.zipMtimeMs, dirty: parsed.dirty === true };
    } catch {
        return null;
    }
}

// 写工作区清单；打开、回写、置脏三处共用，避免字段演进时只改一处导致判断失真。
async function writeManifest(
    workspaceDir: string,
    manifest: ZipWorkspaceManifest,
): Promise<void> {
    await fs.promises.writeFile(
        path.join(workspaceDir, MANIFEST_NAME),
        JSON.stringify(manifest, null, 2),
        "utf-8",
    );
}

// 校验 zip 条目名，阻止 zip-slip 路径穿越。
// 说明：JSZip 在 loadAsync 时会先解析掉 . 和 .. 段（越过根的部分会被收敛到工作区内），
// 能到达这里的名字理论上已不含相对段；本函数对残留风险做「失败即拒绝」的显式拦截：
// 绝对路径（/ 开头）、Windows 盘符（C:/ 开头）和任何残留的 .. 段都直接抛错。
function assertSafeEntryName(entryName: string): string {
    const normalized = entryName.replaceAll("\\", "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
        throw new Error(`压缩包包含非法条目：${entryName}`);
    }
    if (normalized.split("/").some((segment) => segment === "..")) {
        throw new Error(`压缩包包含越界路径：${entryName}`);
    }
    return normalized;
}

// 以流式方式读取单个 zip 条目，边读边累计大小，超过剩余预算立即销毁流并中止。
// 不能用「整个条目解压进内存后再判断长度」：典型压缩炸弹一个条目就能膨胀到数 GB，
// 先解压再限长会在判断生效前把内存撑爆。
async function readEntryCapped(
    entry: JSZip.JSZipObject,
    remainingBytes: number,
    limitMessage: string,
): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let received = 0;
    await new Promise<void>((resolve, reject) => {
        const stream = entry.nodeStream();
        stream.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > remainingBytes) {
                reject(new Error(limitMessage));
                // 超限时主动销毁流停止解压；销毁触发的 premature-close 错误会被 error 监听吸收。
                // 类型声明里的 NodeJS.ReadableStream 没有 destroy 方法，运行时它确实是 Node 流。
                (stream as unknown as { destroy: () => void }).destroy();
                return;
            }
            chunks.push(chunk);
        });
        stream.on("end", () => resolve());
        stream.on("error", (error) => reject(error));
    });
    return Buffer.concat(chunks);
}

// 把 zip 的全部条目解压到工作区目录，累计解压后总大小，超限立即中止并抛错。
async function extractZipToWorkspace(
    zipPath: string,
    workspaceDir: string,
    maxTotalBytes: number,
): Promise<void> {
    const zip = await JSZip.loadAsync(await fs.promises.readFile(zipPath));
    const limitMessage = `压缩包解压后超过大小上限（${Math.floor(maxTotalBytes / 1024 / 1024)}MB），已中止`;
    let totalBytes = 0;
    for (const entry of Object.values(zip.files)) {
        const safeName = assertSafeEntryName(entry.name);
        // 条目名已确认只含安全相对路径，按 / 分段拼到工作区目录下。
        const targetPath = path.join(workspaceDir, ...safeName.split("/"));
        if (entry.dir) {
            // 显式重建目录条目（含空目录），回写时才能保留原压缩包的目录结构。
            await fs.promises.mkdir(targetPath, { recursive: true });
            continue;
        }
        // 传入剩余预算：任何单个条目都不能超过还剩的额度。
        const data = await readEntryCapped(entry, maxTotalBytes - totalBytes, limitMessage);
        totalBytes += data.byteLength;
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, data);
    }
}

// 在工作区内递归查找可打开的 Markdown 文档，按路径排序保证打开顺序稳定。
// 跳过 node_modules（依赖目录里的 md 不是文档）；隐藏目录照常遍历，
// 与回写逻辑保持一致——回写只排除根目录的清单文件，其余条目都原样保留。
async function findMarkdownDocuments(workspaceDir: string): Promise<string[]> {
    const result: string[] = [];
    const walk = async (dir: string): Promise<void> => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === MANIFEST_NAME) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules") continue;
                await walk(fullPath);
            } else if (OPENABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                result.push(fullPath);
            }
        }
    };
    await walk(workspaceDir);
    return result.sort();
}

// 读取单个文档并登记授权，内容与现有打开流程完全一致。
async function readDocument(filePath: string): Promise<OpenDocumentData> {
    authorizeDocument(filePath);
    const [content, stats] = await Promise.all([
        fs.promises.readFile(filePath, "utf-8"),
        fs.promises.stat(filePath),
    ]);
    return { filePath, content, modifiedTime: stats.mtimeMs };
}

// 确保工作区存在且内容与 zip 当前状态一致，返回工作区目录。
// 清单里的 zip mtime 与磁盘不一致（zip 被外部改过）时整目录重建，避免新旧内容混杂。
export async function prepareZipWorkspace(
    zipPath: string,
    maxTotalBytes = MAX_TOTAL_UNCOMPRESSED_BYTES,
): Promise<string> {
    const resolvedZipPath = path.resolve(zipPath);
    const zipStats = await fs.promises.stat(resolvedZipPath);
    if (!zipStats.isFile()) throw new Error(`压缩包不存在：${resolvedZipPath}`);

    const workspaceDir = workspaceDirForZip(resolvedZipPath);
    const manifest = await readManifest(workspaceDir);
    const isFresh =
        manifest !== null &&
        manifest.zipPath === resolvedZipPath &&
        manifest.zipMtimeMs === zipStats.mtimeMs;
    if (!isFresh) {
        // 先整体删除再重建，保证工作区里不会残留旧 zip 的过期文件。
        await fs.promises.rm(workspaceDir, { recursive: true, force: true });
        await fs.promises.mkdir(workspaceDir, { recursive: true });
        try {
            await extractZipToWorkspace(resolvedZipPath, workspaceDir, maxTotalBytes);
        } catch (error) {
            // 解压中途失败（如越界条目、超大小上限）时删掉半成品工作区，
            // 避免下次打开时把残缺内容当成有效工作区，错误本身继续向上抛。
            await fs.promises.rm(workspaceDir, { recursive: true, force: true });
            throw error;
        }
        await writeManifest(workspaceDir, {
            zipPath: resolvedZipPath,
            zipMtimeMs: zipStats.mtimeMs,
            dirty: false,
        });
    }

    // 整个工作区加入授权目录，工作区内的相对图片/附件才能被读取。
    authorizeDirectory(workspaceDir);
    if (!zipWorkspaces.has(workspaceDir)) {
        // 复用旧工作区时保留清单里的脏标记：上次回写失败留下的未写回修改继续受保护。
        zipWorkspaces.set(workspaceDir, {
            zipPath: resolvedZipPath,
            zipMtimeMs: zipStats.mtimeMs,
            dirty: manifest?.dirty === true,
        });
    }
    return workspaceDir;
}

// 打开入口统一走这里：普通文档直接读；.zip 先解压到临时工作区，再读其中的文档。
// 打开对话框、菜单、拖放、命令行参数四个入口共用，保证行为一致。
export async function readDocumentsWithZipSupport(
    filePaths: string[],
): Promise<OpenDocumentData[]> {
    // 第一阶段串行收集文档路径：zip 的解压与查找按顺序进行，
    // 同一 zip 不会并发重复解压；工作区已就绪后读取彼此独立，第二阶段并行完成。
    const documentPaths: string[] = [];
    for (const filePath of filePaths) {
        if (path.extname(filePath).toLowerCase() !== ".zip") {
            documentPaths.push(filePath);
            continue;
        }
        const workspaceDir = await prepareZipWorkspace(filePath);
        const markdownPaths = await findMarkdownDocuments(workspaceDir);
        if (markdownPaths.length === 0) {
            throw new Error(`压缩包内没有找到 Markdown 文档：${filePath}`);
        }
        documentPaths.push(...markdownPaths);
    }
    return Promise.all(documentPaths.map(readDocument));
}

// 把工作区当前内容重新打包回来源 zip。清单文件（仅工作区根目录那份）除外，
// 其余条目全部保留——包括编辑期间粘贴进来的新图片，以及原 zip 里的空目录结构。
// 显式使用 DEFLATE 压缩：JSZip 默认 STORE 会把原本压缩过的 zip 越写越大。
// 写入采用「临时文件 + 同目录 rename」原子替换原 zip，避免写入中途出错损坏压缩包。
export async function repackZipWorkspace(workspaceDir: string): Promise<number> {
    const workspace = zipWorkspaces.get(workspaceDir);
    if (!workspace) {
        throw new Error(`未找到工作区对应的压缩包信息：${workspaceDir}`);
    }
    const zip = new JSZip();
    const collectFiles = async (dir: string): Promise<void> => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            // 清单只写在工作区根目录，只在这里排除；
            // 用户 zip 子目录里若真有同名文件，照常保留，避免静默丢数据。
            if (dir === workspaceDir && entry.name === MANIFEST_NAME) continue;
            const fullPath = path.join(dir, entry.name);
            // zip 条目统一用 / 分隔，与解压时的分段方式对应。
            const entryName = path.relative(workspaceDir, fullPath).split(path.sep).join("/");
            if (entry.isDirectory()) {
                // 显式写入目录条目，保留原压缩包里的空目录。
                zip.folder(entryName);
                await collectFiles(fullPath);
            } else {
                zip.file(entryName, await fs.promises.readFile(fullPath));
            }
        }
    };
    await collectFiles(workspaceDir);
    const data = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });

    const tempZipPath = `${workspace.zipPath}.xmd-repack.tmp`;
    try {
        await fs.promises.writeFile(tempZipPath, data);
        await fs.promises.rename(tempZipPath, workspace.zipPath);
    } catch (error) {
        // 失败时清掉临时文件，避免在用户目录里残留 .xmd-repack.tmp 残骸，错误继续抛出。
        await fs.promises.rm(tempZipPath, { force: true });
        throw error;
    }
    const newMtime = (await fs.promises.stat(workspace.zipPath)).mtimeMs;
    await writeManifest(workspaceDir, {
        zipPath: workspace.zipPath,
        zipMtimeMs: newMtime,
        dirty: false,
    });
    workspace.zipMtimeMs = newMtime;
    workspace.dirty = false;
    return newMtime;
}

// 判断文件是否位于某个已登记的压缩包工作区内；是则返回工作区目录，否则返回 null。
export function findZipWorkspaceForFile(filePath: string): string | null {
    const resolved = path.resolve(filePath);
    for (const workspaceDir of zipWorkspaces.keys()) {
        if (isPathInside(resolved, workspaceDir)) return workspaceDir;
    }
    return null;
}

// 回写失败时由保存流程调用：标记工作区为脏并持久化到清单。
// 清理流程（运行期引用计数 + 启动期按时间清理）都会跳过脏目录，
// 失败弹窗承诺过「请勿手动删除」，这里保证应用自己也不会删。
export function markZipWorkspaceDirty(workspaceDir: string): Promise<void> {
    const workspace = zipWorkspaces.get(workspaceDir);
    if (!workspace) return Promise.resolve();
    workspace.dirty = true;
    return writeManifest(workspaceDir, {
        zipPath: workspace.zipPath,
        zipMtimeMs: workspace.zipMtimeMs,
        dirty: true,
    });
}

// 渲染层每次已打开文档集合变化都会全量同步监听路径，
// 这里用同一份数据计算每个工作区是否仍被某个打开中的文档引用：
// 没有任何文档引用且非脏的工作区可以安全删除。
export async function syncZipWorkspaceUsage(
    openFilePaths: string[],
): Promise<void> {
    const resolvedPaths = openFilePaths.map((filePath) => path.resolve(filePath));
    for (const [workspaceDir, workspace] of zipWorkspaces) {
        const inUse = resolvedPaths.some((filePath) =>
            isPathInside(filePath, workspaceDir),
        );
        if (inUse || workspace.dirty) continue;
        try {
            await fs.promises.rm(workspaceDir, { recursive: true, force: true });
            zipWorkspaces.delete(workspaceDir);
        } catch (error) {
            // 单个工作区删除失败（Windows 上文件被占用很常见）只记录日志，
            // 保留在登记表里等待下次同步重试，不影响其他工作区的清理。
            console.error("[zip-workspace] 清理工作区失败", workspaceDir, error);
        }
    }
}

// 应用启动时清理遗留的过旧工作区（上次异常退出没走正常清理流程的兜底）。
// 清单标记为脏的工作区即使过期也保留：里面有从未写回压缩包的修改，删除即丢数据。
export async function cleanStaleZipWorkspaces(): Promise<void> {
    const rootDir = path.join(os.tmpdir(), WORKSPACES_ROOT_NAME);
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    } catch {
        // 根目录还不存在（从未打开过压缩包）时没有需要清理的内容。
        return;
    }
    const now = Date.now();
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(rootDir, entry.name);
        try {
            const stats = await fs.promises.stat(dirPath);
            if (now - stats.mtimeMs <= STALE_WORKSPACE_AGE_MS) continue;
            const manifest = await readManifest(dirPath);
            if (manifest?.dirty) continue;
            await fs.promises.rm(dirPath, { recursive: true, force: true });
        } catch (error) {
            // 单个目录清理失败不应中断其余遗留工作区的清理。
            console.error("[zip-workspace] 清理遗留工作区失败", dirPath, error);
        }
    }
}
