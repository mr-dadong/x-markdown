import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import chokidar, { type FSWatcher } from "chokidar";
import { IPC_CHANNELS } from "../../src/constants/ipcChannels";
import { assertAuthorizedPath, authorizeDirectory } from "../services/pathAccess";

interface WorkspaceIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
}

// 文件名只能是单个路径片段，防止菜单操作越过当前工作区。
function validateFileTreeName(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName === "." || trimmedName === ".." || /[\\/:*?"<>|]/.test(trimmedName)) {
    throw new Error("名称不能为空，也不能包含 \\ / : * ? \" < > |");
  }
  return trimmedName;
}

export function registerWorkspaceIpc({ getMainWindow }: WorkspaceIpcDependencies): void {
  let workspaceWatcher: FSWatcher | null = null;

  ipcMain.handle(IPC_CHANNELS.selectWorkspace, async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const directoryPath = result.filePaths[0];
    authorizeDirectory(directoryPath);
    await fs.promises.writeFile(path.join(app.getPath("userData"), "workspace.txt"), directoryPath, "utf-8");
    return directoryPath;
  });

  ipcMain.handle(IPC_CHANNELS.getWorkspace, async () => {
    const statePath = path.join(app.getPath("userData"), "workspace.txt");
    try {
      const directoryPath = (await fs.promises.readFile(statePath, "utf-8")).trim();
      const stats = await fs.promises.stat(directoryPath);
      if (!stats.isDirectory()) return null;
      authorizeDirectory(directoryPath);
      return directoryPath;
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.watchWorkspace, async (_event, directoryPath: string) => {
    const authorizedPath = assertAuthorizedPath(directoryPath);
    await workspaceWatcher?.close();
    workspaceWatcher = chokidar.watch(authorizedPath, {
      ignoreInitial: true,
      // 忽略依赖和构建产物，避免大型项目产生大量无关刷新事件。
      ignored: /(^|[/\\])(?:\.[^/\\]+|node_modules|out|dist|release|coverage)(?:[/\\]|$)/,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 },
    });
    let notifyTimer: ReturnType<typeof setTimeout> | null = null;
    workspaceWatcher.on("all", () => {
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = setTimeout(() => {
        getMainWindow()?.webContents.send(IPC_CHANNELS.workspaceChanged);
        notifyTimer = null;
      }, 120);
    });
  });

  ipcMain.handle(IPC_CHANNELS.unwatchWorkspace, async () => {
    await workspaceWatcher?.close();
    workspaceWatcher = null;
  });

  ipcMain.handle(IPC_CHANNELS.readDirectory, async (_event, dirPath: string) => {
    try {
      const authorizedPath = assertAuthorizedPath(dirPath);
      const items = await fs.promises.readdir(authorizedPath, { withFileTypes: true });
      return items
        .filter((item) => !item.name.startsWith("."))
        .map((item) => ({ name: item.name, isDirectory: item.isDirectory(), path: path.join(authorizedPath, item.name) }))
        .sort((left, right) => {
          if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
          return left.name.localeCompare(right.name);
        });
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.createFileTreeEntry, async (_event, data: { parentPath: string; name: string; isDirectory: boolean }) => {
    const parentPath = assertAuthorizedPath(data.parentPath);
    const targetPath = path.join(parentPath, validateFileTreeName(data.name));
    assertAuthorizedPath(targetPath);
    if (data.isDirectory) await fs.promises.mkdir(targetPath);
    else await fs.promises.writeFile(targetPath, "", { flag: "wx" });
  });

  ipcMain.handle(IPC_CHANNELS.renameFileTreeEntry, async (_event, data: { entryPath: string; newName: string }) => {
    const entryPath = assertAuthorizedPath(data.entryPath);
    const targetPath = path.join(path.dirname(entryPath), validateFileTreeName(data.newName));
    assertAuthorizedPath(targetPath);
    await fs.promises.rename(entryPath, targetPath);
  });
  ipcMain.handle(IPC_CHANNELS.deleteFileTreeEntry, async (_event, entryPath: string) => {
    await fs.promises.rm(assertAuthorizedPath(entryPath), { recursive: true });
  });
  ipcMain.handle(IPC_CHANNELS.copyFileTreePath, async (_event, entryPath: string) => {
    clipboard.writeText(assertAuthorizedPath(entryPath));
  });
  ipcMain.handle(IPC_CHANNELS.showFileTreeEntry, async (_event, entryPath: string) => {
    shell.showItemInFolder(assertAuthorizedPath(entryPath));
  });
}
