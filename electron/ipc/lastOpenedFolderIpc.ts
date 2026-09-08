import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../src/constants/ipcChannels";
import {
  getLastOpenedFolderPath,
  setLastOpenedFolderPath,
} from "../services/lastOpenedFolder";

// 上次打开文件夹路径的读写由主进程统一管理并持久化。
export function registerLastOpenedFolderIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getLastOpenedFolder, () => getLastOpenedFolderPath());

  ipcMain.handle(
    IPC_CHANNELS.setLastOpenedFolder,
    (_event, dirPath: string) => setLastOpenedFolderPath(dirPath),
  );
}
