import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import path from "path";
import { IPC_CHANNELS } from "../../src/constants/ipcChannels";

interface OpenDocumentData {
  filePath: string;
  content: string;
  modifiedTime: number;
}

interface ApplicationMenuDependencies {
  getMainWindow: () => BrowserWindow | null;
  readDocuments: (filePaths: string[]) => Promise<OpenDocumentData[]>;
  getRecentFiles: () => string[];
}

let menuDependencies: ApplicationMenuDependencies | null = null;

// 菜单模块只负责系统菜单定义，文件读取仍通过文档领域提供的统一入口完成。
export function createApplicationMenu(
  dependencies: ApplicationMenuDependencies,
): void {
  menuDependencies = dependencies;
  buildApplicationMenu();
}

// 最近打开列表变化后重建菜单，让标题栏菜单与系统菜单始终展示最新条目。
export function rebuildApplicationMenu(): void {
  if (menuDependencies) buildApplicationMenu();
}

function buildApplicationMenu(): void {
  if (!menuDependencies) return;
  const { getMainWindow, readDocuments, getRecentFiles } = menuDependencies;
  const send = (channel: string): void => {
    getMainWindow()?.webContents.send(channel);
  };
  const recentFiles = getRecentFiles();
  const recentFilesSubmenu: MenuItemConstructorOptions[] =
    recentFiles.length === 0
      ? [{ label: "暂无最近打开的文档", enabled: false }]
      : [
          ...recentFiles.map((filePath) => ({
            label: path.basename(filePath),
            toolTip: filePath,
            click: () =>
              getMainWindow()?.webContents.send(
                IPC_CHANNELS.menuOpenRecentFile,
                filePath,
              ),
          })),
          { type: "separator" },
          {
            label: "清空最近打开",
            click: () => send(IPC_CHANNELS.menuClearRecentFiles),
          },
        ];
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "新建", accelerator: "CmdOrCtrl+N", click: () => send(IPC_CHANNELS.menuNewFile) },
        {
          label: "打开",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const mainWindow = getMainWindow();
            if (!mainWindow) return;
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ["openFile", "multiSelections"],
              filters: [
                { name: "Markdown", extensions: ["md", "markdown", "txt"] },
                { name: "所有文件", extensions: ["*"] },
              ],
            });
            if (result.canceled) return;
            const files = await readDocuments(result.filePaths);
            files.forEach((file) => getMainWindow()?.webContents.send(IPC_CHANNELS.menuOpenFile, file));
          },
        },
        { label: "最近打开", submenu: recentFilesSubmenu },
        { label: "保存", accelerator: "CmdOrCtrl+S", click: () => send(IPC_CHANNELS.menuSaveFile) },
        { label: "另存为", accelerator: "CmdOrCtrl+Shift+S", click: () => send(IPC_CHANNELS.menuSaveAsFile) },
        { type: "separator" },
        { label: "导出为 HTML…", accelerator: "CmdOrCtrl+Shift+E", click: () => send(IPC_CHANNELS.menuExportHtml) },
        { label: "导出为 PDF…", click: () => send(IPC_CHANNELS.menuExportPdf) },
        { label: "导出为 ZIP 包…", click: () => send(IPC_CHANNELS.menuExportZip) },
        { type: "separator" },
        { label: "退出", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "CmdOrCtrl+Shift+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
        { type: "separator" },
        { label: "查找", accelerator: "CmdOrCtrl+F", click: () => send(IPC_CHANNELS.menuFindReplace) },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", accelerator: "CmdOrCtrl+R", role: "reload" },
        { type: "separator" },
        { label: "实际大小", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "放大", accelerator: "CmdOrCtrl+Plus", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", accelerator: "F11", role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", accelerator: "CmdOrCtrl+M", role: "minimize" },
        { label: "关闭", accelerator: "CmdOrCtrl+W", role: "close" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  // 保留系统菜单才能让 Windows 快捷键生效，只隐藏菜单栏本身。
  getMainWindow()?.setMenuBarVisibility(false);
}
