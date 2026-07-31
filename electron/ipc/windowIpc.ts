import { BrowserWindow, ipcMain, Menu } from "electron";
import { IPC_CHANNELS } from "../../src/constants/ipcChannels";

interface WindowIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  approveClose: () => void;
  rendererReady: () => void;
}

// 窗口相关 channel 在一个入口注册，主进程只提供所需状态和回调。
export function registerWindowIpc({
  getMainWindow,
  approveClose,
  rendererReady,
}: WindowIpcDependencies): void {
  ipcMain.on(IPC_CHANNELS.windowMinimize, () => {
    getMainWindow()?.minimize();
  });

  ipcMain.on(IPC_CHANNELS.windowMaximize, () => {
    const window = getMainWindow();
    if (window?.isMaximized()) {
      window.unmaximize();
    } else {
      window?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.windowClose, () => {
    getMainWindow()?.close();
  });

  ipcMain.on(IPC_CHANNELS.confirmWindowClose, () => {
    approveClose();
    getMainWindow()?.close();
  });

  ipcMain.on(IPC_CHANNELS.rendererReady, rendererReady);

  ipcMain.handle(
    IPC_CHANNELS.showApplicationMenu,
    async (
      _event,
      { menuIndex, x, y }: { menuIndex: number; x: number; y: number },
    ) => {
      const mainWindow = getMainWindow();
      const applicationMenu = Menu.getApplicationMenu();
      const submenu = applicationMenu?.items[menuIndex]?.submenu;
      if (!mainWindow || !submenu) return;

      await new Promise<void>((resolve) => {
        submenu.popup({ window: mainWindow, x, y, callback: resolve });
      });
    },
  );
}
