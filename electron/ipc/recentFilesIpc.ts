import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../src/constants/ipcChannels";
import {
  addRecentFiles,
  clearRecentFiles,
  getRecentFiles,
  removeRecentFile,
} from "../services/recentFiles";

// 最近打开列表的增删查全部由主进程统一管理并持久化。
export function registerRecentFilesIpc(): void {
  ipcMain.handle(IPC_CHANNELS.recentFilesList, () => getRecentFiles());

  ipcMain.handle(
    IPC_CHANNELS.recentFilesAdd,
    (_event, filePaths: string[]) => addRecentFiles(filePaths),
  );

  ipcMain.handle(
    IPC_CHANNELS.recentFilesRemove,
    (_event, filePath: string) => removeRecentFile(filePath),
  );

  ipcMain.handle(IPC_CHANNELS.recentFilesClear, () => clearRecentFiles());
}
