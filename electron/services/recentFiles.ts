import { app } from "electron";
import fs from "fs";
import path from "path";
import { authorizeDocument } from "./pathAccess";
import { rebuildApplicationMenu } from "../app/applicationMenu";

const MAX_RECENT_FILES = 10;
const supportedFileExtensions = new Set([".md", ".markdown", ".txt"]);

// 最近打开列表保存在 Electron 用户数据目录，与工作区、恢复草稿的持久化方式一致。
let recentFilePaths: string[] = [];
let stateLoaded = false;

const getStatePath = (): string =>
  path.join(app.getPath("userData"), "recent-files.json");

const normalizeFilePath = (filePath: string): string => {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32"
    ? resolvedPath.toLocaleLowerCase()
    : resolvedPath;
};

// 只接受应用支持且真实存在的文件，避免无效路径被渲染进程用来授权读取任意文件。
function isValidRecentFile(filePath: string): boolean {
  if (!supportedFileExtensions.has(path.extname(filePath).toLocaleLowerCase()))
    return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function loadState(): string[] {
  if (stateLoaded) return recentFilePaths;
  stateLoaded = true;
  try {
    const raw = fs.readFileSync(getStatePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return recentFilePaths;

    const seen = new Set<string>();
    const validPaths: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string" || !isValidRecentFile(item)) continue;
      const normalized = normalizeFilePath(item);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      validPaths.push(item);
    }
    recentFilePaths = validPaths.slice(0, MAX_RECENT_FILES);
    // 重新打开最近文件前需要授权，否则 readFile 校验会拒绝访问。
    recentFilePaths.forEach(authorizeDocument);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("读取最近打开记录失败:", error);
    }
  }
  return recentFilePaths;
}

async function persistState(): Promise<void> {
  if (recentFilePaths.length === 0) {
    await fs.promises.rm(getStatePath(), { force: true });
    return;
  }
  await fs.promises.writeFile(
    getStatePath(),
    JSON.stringify(recentFilePaths),
    "utf-8",
  );
}

export function getRecentFiles(): string[] {
  return loadState();
}

// 批量打开时按传入顺序依次置顶，最后打开的文件成为列表第一项。
export async function addRecentFiles(filePaths: string[]): Promise<void> {
  const validPaths = filePaths.filter(isValidRecentFile);
  if (validPaths.length === 0) return;
  loadState();

  for (const filePath of validPaths) {
    const normalized = normalizeFilePath(filePath);
    recentFilePaths = recentFilePaths.filter(
      (item) => normalizeFilePath(item) !== normalized,
    );
    recentFilePaths.unshift(filePath);
  }
  recentFilePaths = recentFilePaths.slice(0, MAX_RECENT_FILES);
  validPaths.forEach(authorizeDocument);

  await persistState();
  // macOS 的 Dock 菜单和 Windows 跳转列表也跟随应用内的最近打开记录。
  validPaths.forEach((filePath) => app.addRecentDocument(filePath));
  rebuildApplicationMenu();
}

export async function removeRecentFile(filePath: string): Promise<void> {
  loadState();
  const normalized = normalizeFilePath(filePath);
  const nextPaths = recentFilePaths.filter(
    (item) => normalizeFilePath(item) !== normalized,
  );
  if (nextPaths.length === recentFilePaths.length) return;
  recentFilePaths = nextPaths;
  await persistState();
  rebuildApplicationMenu();
}

export async function clearRecentFiles(): Promise<void> {
  loadState();
  if (recentFilePaths.length === 0) return;
  recentFilePaths = [];
  await persistState();
  app.clearRecentDocuments();
  rebuildApplicationMenu();
}
