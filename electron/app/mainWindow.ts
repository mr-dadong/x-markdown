import { BrowserWindow, shell } from "electron";
import path from "path";
import { IPC_CHANNELS } from "../../src/constants/ipcChannels";

interface MainWindowDependencies {
  isCloseApproved: () => boolean;
  isRendererReady: () => boolean;
  onReadyToShow: () => void;
  onClosed: () => void;
}

// 主窗口模块只负责创建窗口和绑定窗口级事件，业务状态仍由启动入口统一管理。
export function createMainWindow({
  isCloseApproved,
  isRendererReady,
  onReadyToShow,
  onClosed,
}: MainWindowDependencies): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#f5f5f5",
    icon: path.join(__dirname, "../../build/icons/256x256.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  // electron-vite 仅在开发模式提供该地址，生产环境加载构建后的页面。
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", onReadyToShow);

  // 应用窗口不允许跳转到远程页面，合法外链统一交给系统默认应用。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (["http:", "https:", "mailto:"].includes(parsedUrl.protocol)) {
        void shell.openExternal(parsedUrl.toString());
      }
    } catch {
      // 无效地址直接拒绝，不让它进入应用窗口。
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  mainWindow.on("close", (event) => {
    if (isCloseApproved() || !isRendererReady()) return;
    event.preventDefault();
    mainWindow.webContents.send(IPC_CHANNELS.requestWindowClose);
  });
  mainWindow.on("closed", onClosed);

  return mainWindow;
}
