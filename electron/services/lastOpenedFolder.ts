import { app } from "electron";
import fs from "fs";
import path from "path";

// 上一次打开的文件夹路径保存在 Electron 用户数据目录，与最近文件、工作区等持久化方式一致。
let lastOpenedFolderPath: string | null = null;
let stateLoaded = false;

// 状态文件路径：userData/last-opened-folder.json
const getStatePath = (): string =>
  path.join(app.getPath("userData"), "last-opened-folder.json");

// 从磁盘加载上次打开的文件夹路径
function loadState(): string | null {
  if (stateLoaded) return lastOpenedFolderPath;
  stateLoaded = true;
  try {
    const raw = fs.readFileSync(getStatePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    // 只接受字符串类型且目录真实存在
    if (typeof parsed === "string" && isValidDirectory(parsed)) {
      lastOpenedFolderPath = parsed;
    }
  } catch (error) {
    // 文件不存在是正常情况（首次启动），其他错误打印日志
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("读取上次打开文件夹记录失败:", error);
    }
  }
  return lastOpenedFolderPath;
}

// 将当前路径持久化到磁盘
async function persistState(): Promise<void> {
  if (!lastOpenedFolderPath) {
    // 无记录时删除状态文件，避免残留空值
    await fs.promises.rm(getStatePath(), { force: true });
    return;
  }
  await fs.promises.writeFile(
    getStatePath(),
    JSON.stringify(lastOpenedFolderPath),
    "utf-8",
  );
}

// 校验目录是否真实存在且是文件夹
function isValidDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

// 获取上一次打开的文件夹路径，供文件对话框 defaultPath 使用
export function getLastOpenedFolderPath(): string | null {
  return loadState();
}

// 记录本次打开的文件夹路径，打开文件成功后调用
export async function setLastOpenedFolderPath(dirPath: string): Promise<void> {
  if (!isValidDirectory(dirPath)) return;
  lastOpenedFolderPath = dirPath;
  await persistState();
}
