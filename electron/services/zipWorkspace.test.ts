import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import JSZip from "jszip";

// 压缩包工作区的行为约束：
// - 解压后内部 Markdown 文档的相对图片路径必须能被现有 editorFilePath 链路解析，
//   这是「zip 内文档在所见即所得中能看到图片」的核心前提；
// - 越界条目（zip-slip）与超限内容必须被拒绝，且不留半成品工作区；
// - 保存后的回写必须把修改写回 zip 且不混入内部清单文件；
// - 引用归零清理工作区，但脏工作区（回写失败）必须保留。
//
// 注意：工作区登记状态是模块级全局，测试之间会互相影响，
// 因此每个用例只操作自己沙箱内创建的 zip，结尾统一清理。

let zipWorkspace: typeof import("./zipWorkspace");
let resolveEditorFilePath: typeof import("./editorFilePath").resolveEditorFilePath;

const createdRoots: string[] = [];

before(async () => {
    ({ resolveEditorFilePath } = await import("./editorFilePath"));
    zipWorkspace = await import("./zipWorkspace");
});

// JSZip 在生成时会自动净化条目名（把 ../ 段抹掉），用它做不出真正的恶意 zip，
// 因此这里手工拼一个最小 zip（仅存储、不压缩），条目名原样写入。
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const buildRawZip = (entries: Array<{ name: string; data: string }>): Buffer => {
    const nameBuffers = entries.map((entry) =>
        Buffer.from(entry.name.replaceAll("\\", "/"), "utf-8"),
    );
    const dataBuffers = entries.map((entry) => Buffer.from(entry.data, "utf-8"));
    const crcs = dataBuffers.map((data) => crc32(data));

    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;
    entries.forEach((_entry, index) => {
        const name = nameBuffers[index];
        const data = dataBuffers[index];
        const crc = crcs[index];
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
        local.writeUInt16LE(20, 4); // 解压所需版本
        local.writeUInt16LE(0, 6); // 标志位
        local.writeUInt16LE(0, 8); // 压缩方式：0 = 存储
        local.writeUInt16LE(0, 10); // 修改时间（占位）
        local.writeUInt16LE(0x21, 12); // 修改日期（占位）
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28); // 扩展区长度
        localParts.push(local, name, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); // 中央目录头签名
        central.writeUInt16LE(20, 4); // 创建版本
        central.writeUInt16LE(20, 6); // 解压所需版本
        central.writeUInt16LE(0, 8); // 标志位
        central.writeUInt16LE(0, 10); // 压缩方式：0 = 存储
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(0, 30); // 扩展区/注释长度等占位
        central.writeUInt32LE(offset, 42); // 对应本地头偏移
        centralParts.push(central, name);
        offset += local.length + name.length + data.length;
    });

    const centralDirectory = Buffer.concat(centralParts);
    const localData = Buffer.concat(localParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // 结束记录签名
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(localData.length, 16);
    return Buffer.concat([localData, centralDirectory, end]);
};

// 在独立沙箱目录里生成一个真实 zip 文件，返回它的路径。
// 需要恶意条目名时用 buildRawZip 直接写字节。
const createZipFile = async (
    name: string,
    entries: Record<string, string>,
): Promise<string> => {
    const root = mkdtempSync(path.join(tmpdir(), `xmd-ziptest-${name}-`));
    createdRoots.push(root);
    const zipPath = path.join(root, `${name}.zip`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(zipPath, buildRawZip(Object.entries(entries).map(([entryName, content]) => ({ name: entryName, data: content }))));
    return zipPath;
};

after(async () => {
    // 空集合表示没有任何打开中的文档，所有非脏工作区都会被清理。
    await zipWorkspace.syncZipWorkspaceUsage([]);
    for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
});

describe("压缩包工作区", () => {
    test("解压后相对图片路径可被 editorFilePath 链路解析并读到内容", async () => {
        const zipPath = await createZipFile("images", {
            "docs/article.md": "![图](./assets/pic.png)",
            "docs/assets/pic.png": "PNG-BYTES",
        });

        const documents = await zipWorkspace.readDocumentsWithZipSupport([zipPath]);
        assert.equal(documents.length, 1);
        assert.equal(documents[0].content, "![图](./assets/pic.png)");

        // 所见即所得读图走的正是这条链路：相对地址 + 当前文档路径 → 工作区内真实文件。
        const resolved = resolveEditorFilePath(
            "./assets/pic.png",
            documents[0].filePath,
        );
        const fs = await import("node:fs/promises");
        assert.equal(await fs.readFile(resolved, "utf-8"), "PNG-BYTES");
    });

    test("zip-slip 越界条目不会写出工作区", async () => {
        // zip 放在子目录里：若解压不防穿越，../escape.png 会写到沙箱根目录。
        // 用 .png 而非 .txt，避免 JSZip 收敛后的条目被「可打开文档」规则统计进来。
        const zipPath = await createZipFile("slip", {
            "../escape.png": "evil",
            "doc.md": "内容",
        });
        const fs = await import("node:fs/promises");
        const sandboxRoot = path.dirname(zipPath);
        const nestedZipPath = path.join(sandboxRoot, "nested", "slip.zip");
        await fs.mkdir(path.dirname(nestedZipPath), { recursive: true });
        await fs.rename(zipPath, nestedZipPath);

        const documents = await zipWorkspace.readDocumentsWithZipSupport([nestedZipPath]);
        assert.equal(documents.length, 1);
        // JSZip 会把 ../ 段收敛到工作区内，越界文件绝不能出现在沙箱根目录。
        assert.equal(
            await fs.stat(path.join(sandboxRoot, "escape.png")).then(() => true, () => false),
            false,
        );
    });

    test("绝对路径条目被拒绝", async () => {
        // JSZip 不会净化 / 开头的条目名，必须由我们的校验显式拒绝。
        const zipPath = await createZipFile("absolute", {
            "/abs.txt": "evil",
            "doc.md": "内容",
        });
        await assert.rejects(
            zipWorkspace.readDocumentsWithZipSupport([zipPath]),
            /非法条目/u,
        );
    });

    test("解压总大小超过上限被拒绝", async () => {
        const zipPath = await createZipFile("limit", {
            "doc.md": "0123456789",
            "assets/a.bin": "0123456789",
        });

        await assert.rejects(
            zipWorkspace.prepareZipWorkspace(zipPath, 10),
            /超过大小上限/u,
        );
    });

    test("保存后回写 zip：文档修改、图片保留、清单不混入", async () => {
        const zipPath = await createZipFile("repack", {
            "article.md": "旧内容",
            "assets/pic.png": "PNG-BYTES",
        });

        const documents = await zipWorkspace.readDocumentsWithZipSupport([zipPath]);
        const docPath = documents[0].filePath;
        const fs = await import("node:fs/promises");
        await fs.writeFile(docPath, "新内容", "utf-8");

        const workspaceDir = zipWorkspace.findZipWorkspaceForFile(docPath);
        assert.notEqual(workspaceDir, null);
        await zipWorkspace.repackZipWorkspace(workspaceDir!);

        const repacked = await JSZip.loadAsync(await fs.readFile(zipPath));
        assert.equal(await repacked.file("article.md")?.async("string"), "新内容");
        assert.equal(
            await repacked.file("assets/pic.png")?.async("string"),
            "PNG-BYTES",
        );
        // 内部清单文件只存在于工作区，不能泄漏进压缩包。
        assert.equal(repacked.file(".xmd-zip-manifest.json"), null);
    });

    test("zip 被外部修改后再次打开会重新解压", async () => {
        const zipPath = await createZipFile("stale", { "doc.md": "第一版" });
        const first = await zipWorkspace.readDocumentsWithZipSupport([zipPath]);
        assert.equal(first[0].content, "第一版");

        // 模拟外部程序改写了 zip（内容变化必然带来 mtime 变化）。
        const fs = await import("node:fs/promises");
        const zip = new JSZip();
        zip.file("doc.md", "第二版");
        await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

        const second = await zipWorkspace.readDocumentsWithZipSupport([zipPath]);
        assert.equal(second[0].content, "第二版");
    });

    test("引用归零清理工作区，脏工作区保留", async () => {
        const zipPath = await createZipFile("cleanup", { "doc.md": "内容" });
        const documents = await zipWorkspace.readDocumentsWithZipSupport([zipPath]);
        const docPath = documents[0].filePath;
        const workspaceDir = zipWorkspace.findZipWorkspaceForFile(docPath)!;
        const fs = await import("node:fs/promises");

        // 文档仍打开：工作区保留。
        await zipWorkspace.syncZipWorkspaceUsage([docPath]);
        assert.equal(await fs.stat(workspaceDir).then(() => true, () => false), true);

        // 回写失败置脏后即使关闭文档也保留（脏标记同时持久化到清单，跨重启生效）。
        await zipWorkspace.markZipWorkspaceDirty(workspaceDir);
        const manifest = JSON.parse(
            await fs.readFile(path.join(workspaceDir, ".xmd-zip-manifest.json"), "utf-8"),
        ) as { dirty: boolean };
        assert.equal(manifest.dirty, true);
        await zipWorkspace.syncZipWorkspaceUsage([]);
        assert.equal(await fs.stat(workspaceDir).then(() => true, () => false), true);

        // 非脏且无人使用：清理。
        await zipWorkspace.repackZipWorkspace(workspaceDir);
        await zipWorkspace.syncZipWorkspaceUsage([]);
        assert.equal(await fs.stat(workspaceDir).then(() => true, () => false), false);
    });

    test("按时间清理遗留工作区时跳过脏工作区", async () => {
        const zipPath = await createZipFile("stale-dirty", { "doc.md": "内容" });
        const documents = await zipWorkspace.readDocumentsWithZipSupport([zipPath]);
        const workspaceDir = zipWorkspace.findZipWorkspaceForFile(documents[0].filePath)!;
        const fs = await import("node:fs/promises");

        // 模拟过期（8 天前）的脏工作区：即使超过保留期也不能被自动清理。
        const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        await zipWorkspace.markZipWorkspaceDirty(workspaceDir);
        await fs.utimes(workspaceDir, past, past);
        await zipWorkspace.cleanStaleZipWorkspaces();
        assert.equal(await fs.stat(workspaceDir).then(() => true, () => false), true);

        // 回写成功后脏标记清除：同样的过期工作区会被正常清理。
        await zipWorkspace.repackZipWorkspace(workspaceDir);
        await fs.utimes(workspaceDir, past, past);
        await zipWorkspace.cleanStaleZipWorkspaces();
        assert.equal(await fs.stat(workspaceDir).then(() => true, () => false), false);
    });

    test("回写保留空目录结构，且仅排除根目录清单", async () => {
        // JSZip 手工造包：一个空目录 + 一个与清单同名的普通文件（放在子目录里）。
        const root = mkdtempSync(path.join(tmpdir(), "xmd-ziptest-emptydir-"));
        createdRoots.push(root);
        const zip = new JSZip();
        zip.file("doc.md", "内容");
        zip.folder("empty-dir");
        // 与内部清单同名的文件放在子目录里，验证它不会被误排除。
        zip.file("nested/.xmd-zip-manifest.json", "用户自己的文件");
        const zipPath = path.join(root, "emptydir.zip");
        const { writeFile } = await import("node:fs/promises");
        await writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

        const documents = await zipWorkspace.readDocumentsWithZipSupport([zipPath]);
        const workspaceDir = zipWorkspace.findZipWorkspaceForFile(documents[0].filePath)!;
        await zipWorkspace.repackZipWorkspace(workspaceDir);

        const fs = await import("node:fs/promises");
        const repacked = await JSZip.loadAsync(await fs.readFile(zipPath));
        // 空目录以目录条目的形式保留下来。
        assert.equal(repacked.files["empty-dir/"]?.dir, true);
        // 子目录里与用户清单同名的文件不能被误删。
        assert.equal(
            await repacked.file("nested/.xmd-zip-manifest.json")?.async("string"),
            "用户自己的文件",
        );
        // 工作区根目录的内部清单仍然不混入压缩包。
        assert.equal(repacked.file(".xmd-zip-manifest.json"), null);
    });
});
