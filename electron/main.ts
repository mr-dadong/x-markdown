import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  nativeImage,
  protocol,
  session,
  shell,
} from "electron";
import path from "path";
import fs from "fs";
import { createHash, randomUUID } from "crypto";
import { Readable } from "stream";
import { fileURLToPath, pathToFileURL } from "url";
import {
  assertAuthorizedPath,
  authorizeDirectory,
  authorizeDocument,
  authorizeFile,
} from "./services/pathAccess";
import { registerWindowIpc } from "./ipc/windowIpc";
import { registerWorkspaceIpc } from "./ipc/workspaceIpc";
import { createApplicationMenu } from "./app/applicationMenu";
import { createMainWindow } from "./app/mainWindow";
import { IPC_CHANNELS } from "../src/constants/ipcChannels";
import type {
  AttachmentCopyProgress,
  ExportHtmlData,
  ExportZipData,
} from "../src/types/electron";

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let rendererViewReady = false;
let windowReadyToShow = false;
let closeApproved = false;
let selectedUpdate: SelectedUpdate | null = null;
let verifiedUpdate: { filePath: string; sha256: string } | null = null;
let updateDownloadInProgress = false;
const pendingFilePaths: string[] = [];
const supportedFileExtensions = new Set([".md", ".markdown", ".txt"]);
const updateManifestUrl =
  "https://cnb.cool/X-2026/x-markdown/-/git/raw/main/changelogs/version.json";
const installerExtensions = new Set([
  ".exe",
  ".msi",
  ".dmg",
  ".pkg",
  ".appimage",
  ".deb",
  ".rpm",
]);

// 先完整写入同目录临时文件，再替换目标文件，避免写入中断时截断原文档。
async function writeTextFileAtomically(
  filePath: string,
  content: string,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );

  try {
    await fs.promises.writeFile(temporaryPath, content, {
      encoding: "utf-8",
      flag: "wx",
    });

    // Windows 无法稳定地通过 rename 覆盖已有文件，会返回 EPERM。
    // 临时文件已经完整写入，删除旧文件后再移动，可避免直接写入时产生半截内容。
    if (process.platform === "win32") {
      await fs.promises.rm(filePath, { force: true });
    }
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

// 视频通过自定义安全协议流式读取，避免把大型视频整体转成 base64 占用内存。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "xmd-media",
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

interface UpdatePackage {
  arch: string;
  format: string;
  installer: string;
  filename: string;
  url: string;
  sha256: string;
}

interface UpdateRelease {
  title: string;
  version: string;
  date: string;
  channel: string;
  content: string[];
  downloads: Record<
    string,
    {
      available: boolean;
      requirements: string;
      packages: Array<{
        arch: string;
        format: string;
        installer: string;
        filename: string | null;
        url: string | null;
        sha256?: string | null;
      }>;
    }
  >;
}

interface UpdateManifest {
  latest: string;
  releases: UpdateRelease[];
}

interface SelectedUpdate extends Omit<UpdateRelease, "downloads"> {
  download: UpdatePackage;
}

function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.latest !== "string" || !Array.isArray(manifest.releases))
    return false;

  return manifest.releases.every((item) => {
    if (!item || typeof item !== "object") return false;
    const release = item as Record<string, unknown>;
    return (
      typeof release.title === "string" &&
      typeof release.version === "string" &&
      typeof release.date === "string" &&
      typeof release.channel === "string" &&
      Array.isArray(release.content) &&
      release.content.every((contentItem) => typeof contentItem === "string") &&
      !!release.downloads &&
      typeof release.downloads === "object"
    );
  });
}

// 更新检测和更新日志统一读取同一份版本清单，避免两份发布信息出现差异。
async function fetchUpdateManifest(): Promise<UpdateManifest> {
  const requestUrl = new URL(updateManifestUrl);
  // 主分支清单地址固定不变，附加时间戳可绕过客户端与 CDN 的历史缓存，确保跨版本更新时拿到真正的最新版本。
  requestUrl.searchParams.set("timestamp", Date.now().toString());
  const response = await net.fetch(requestUrl.toString(), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`获取版本信息失败（${response.status}）`);

  const manifest: unknown = await response.json();
  if (!isUpdateManifest(manifest)) throw new Error("版本信息格式不正确");
  return manifest;
}

// 清单使用易读的平台名称，Electron 使用 Node.js 平台名称，这里集中完成转换。
function getManifestPlatform(): "windows" | "macos" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "linux") return "linux";
  throw new Error(`当前系统暂不支持自动更新：${process.platform}`);
}

function selectUpdate(release: UpdateRelease): SelectedUpdate {
  const platformName = getManifestPlatform();
  const platform = release.downloads[platformName];
  if (!platform || !platform.available)
    throw new Error(`v${release.version} 暂未提供当前系统的安装包`);

  const selectedPackage = platform.packages.find(
    (item) => item.arch === process.arch,
  );
  if (!selectedPackage)
    throw new Error(
      `v${release.version} 暂未提供 ${process.arch} 架构的安装包`,
    );
  if (!selectedPackage.filename || !selectedPackage.url)
    throw new Error("安装包信息不完整");
  if (!selectedPackage.sha256 || !/^[a-f\d]{64}$/iu.test(selectedPackage.sha256))
    throw new Error("安装包缺少有效的 SHA-256 校验值");
  ensureHttpsUrl(selectedPackage.url);

  return {
    title: release.title,
    version: release.version,
    date: release.date,
    channel: release.channel,
    content: release.content,
    download: {
      arch: selectedPackage.arch,
      format: selectedPackage.format,
      installer: selectedPackage.installer,
      filename: selectedPackage.filename,
      url: selectedPackage.url,
      sha256: selectedPackage.sha256.toLocaleLowerCase(),
    },
  };
}

// 按数字逐段比较版本，只有远端版本更高时才提示更新。
function compareVersions(left: string, right: string): number {
  const leftParts = left.trim().replace(/^v/i, "").split(".").map(Number);
  const rightParts = right.trim().replace(/^v/i, "").split(".").map(Number);
  if (
    [...leftParts, ...rightParts].some(
      (part) => !Number.isInteger(part) || part < 0,
    )
  ) {
    throw new Error("版本号格式不正确");
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function ensureHttpsUrl(url: string): URL {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:")
    throw new Error("更新地址必须使用 HTTPS");
  return parsedUrl;
}

// 只接收应用支持且真实存在的文件，避免把 Electron 自身的启动参数误当成文档。
async function getFilePathsFromArguments(
  commandLine: string[],
): Promise<string[]> {
  const candidates = commandLine
    .map((argument) => path.resolve(argument))
    .filter((filePath) =>
      supportedFileExtensions.has(path.extname(filePath).toLowerCase()),
    );
  const checkedPaths = await Promise.all(
    candidates.map(async (filePath) => {
      const isFile = await fs.promises
        .stat(filePath)
        .then((stats) => stats.isFile())
        .catch(() => false);
      return isFile ? filePath : null;
    }),
  );
  return checkedPaths.filter(
    (filePath): filePath is string => filePath !== null,
  );
}

async function takePendingFiles(): Promise<
  Array<{ filePath: string; content: string; modifiedTime: number }>
> {
  if (pendingFilePaths.length === 0) return [];
  const filePaths = pendingFilePaths.splice(0, pendingFilePaths.length);
  return Promise.all(
    filePaths.map(async (filePath) => {
      authorizeDocument(filePath);
      const [content, stats] = await Promise.all([
        fs.promises.readFile(filePath, "utf-8"),
        fs.promises.stat(filePath),
      ]);
      return { filePath, content, modifiedTime: stats.mtimeMs };
    }),
  );
}

// 使用流式哈希校验大型安装包，避免把整个文件一次性读入主进程内存。
async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function openPendingFiles(): Promise<void> {
  if (!mainWindow || !rendererReady) return;
  const files = await takePendingFiles();
  files.forEach((file) =>
    mainWindow?.webContents.send(IPC_CHANNELS.menuOpenFile, file),
  );
}

function queueFilesToOpen(filePaths: string[]): void {
  filePaths.forEach((filePath) => {
    if (!pendingFilePaths.includes(filePath)) pendingFilePaths.push(filePath);
  });
  void openPendingFiles();
}

// Windows 右键打开多个文件时复用同一个应用实例，并把新文件交给现有窗口。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    void getFilePathsFromArguments(commandLine).then(queueFilesToOpen);
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// macOS 从访达选择“打开方式”时会通过 open-file 事件传入文件。
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  queueFilesToOpen([filePath]);
});

function createWindow(): void {
  rendererReady = false;
  rendererViewReady = false;
  windowReadyToShow = false;
  closeApproved = false;
  mainWindow = createMainWindow({
    isCloseApproved: () => closeApproved,
    isRendererReady: () => rendererReady,
    onReadyToShow: () => {
      windowReadyToShow = true;
      if (rendererViewReady) mainWindow?.show();
    },
    onClosed: () => {
      mainWindow = null;
    },
  });
}

function createMenu(): void {
  createApplicationMenu({
    getMainWindow: () => mainWindow,
    readDocuments: async (filePaths) => Promise.all(
      filePaths.map(async (filePath) => {
        authorizeDocument(filePath);
        const [content, stats] = await Promise.all([
          fs.promises.readFile(filePath, "utf-8"),
          fs.promises.stat(filePath),
        ]);
        return { filePath, content, modifiedTime: stats.mtimeMs };
      }),
    ),
  });
}

registerWindowIpc({
  getMainWindow: () => mainWindow,
  approveClose: () => {
    closeApproved = true;
  },
  // 渲染页面完成监听器注册后再发送启动文件，避免首次启动丢失文件路径。
  rendererReady: async () => {
    rendererReady = true;
    return takePendingFiles();
  },
  rendererViewReady: () => {
    rendererViewReady = true;
    if (windowReadyToShow) mainWindow?.show();
  },
});

// 更新清单由主进程读取，避免网页跨域策略影响检测结果。
ipcMain.handle(IPC_CHANNELS.checkForUpdates, async () => {
  const manifest = await fetchUpdateManifest();

  const currentVersion = app.getVersion();
  const hasUpdate = compareVersions(manifest.latest, currentVersion) > 0;
  if (!hasUpdate) {
    selectedUpdate = null;
    verifiedUpdate = null;
    return { hasUpdate: false, currentVersion, update: null };
  }

  const latestRelease = manifest.releases.find(
    (release) => release.version.trim() === manifest.latest.trim(),
  );
  if (!latestRelease)
    throw new Error(`找不到最新版 v${manifest.latest} 的发布信息`);

  selectedUpdate = selectUpdate(latestRelease);
  verifiedUpdate = null;
  return {
    hasUpdate: true,
    currentVersion,
    update: selectedUpdate,
  };
});

// 外部链接统一交给系统默认应用打开，并限制协议，避免渲染进程执行未知地址。
ipcMain.handle(IPC_CHANNELS.openExternalLink, async (_event, url: string) => {
  const parsedUrl = new URL(url);
  if (!["http:", "https:", "mailto:"].includes(parsedUrl.protocol)) {
    throw new Error("仅支持打开网页和邮箱链接");
  }
  await shell.openExternal(parsedUrl.toString());
});

ipcMain.handle(
  IPC_CHANNELS.downloadUpdate,
  async () => {
    if (!selectedUpdate) throw new Error("请先检查并确认可用更新");
    if (updateDownloadInProgress) throw new Error("安装包正在下载");

    const currentUpdate = selectedUpdate;
    const parsedUrl = ensureHttpsUrl(currentUpdate.download.url);
    updateDownloadInProgress = true;
    verifiedUpdate = null;

    try {
      const response = await net.fetch(parsedUrl.toString(), {
        method: "HEAD",
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`下载安装包失败（${response.status}）`);
      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";

      // 网盘分享链接返回网页而非安装包，交给系统浏览器完成网盘验证和下载。
      if (contentType.includes("text/html")) {
        await shell.openExternal(parsedUrl.toString());
        return { status: "external" as const };
      }

      return await new Promise<{ status: "downloaded"; filePath: string }>(
        (resolve, reject) => {
          const onWillDownload = (
            _downloadEvent: Electron.Event,
            item: Electron.DownloadItem,
          ): void => {
            const extension = path
              .extname(currentUpdate.download.filename)
              .toLowerCase();
            if (
              !installerExtensions.has(extension) ||
              path.extname(item.getFilename()).toLowerCase() !== extension
            ) {
              item.cancel();
              reject(new Error("下载地址没有返回支持的安装包"));
              return;
            }

            const savePath = path.join(
              app.getPath("temp"),
              `XMD-update-${Date.now()}${extension}`,
            );
            item.setSavePath(savePath);
            item.on("updated", () => {
              const totalBytes = item.getTotalBytes();
              const receivedBytes = item.getReceivedBytes();
              const percent =
                totalBytes > 0
                  ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
                  : 0;
              mainWindow?.webContents.send(IPC_CHANNELS.updateDownloadProgress, {
                percent,
                receivedBytes,
                totalBytes,
              });
            });
            item.once("done", (_doneEvent, state) => {
              if (state !== "completed") {
                reject(new Error("安装包下载未完成"));
                return;
              }
              void calculateFileSha256(savePath).then((actualSha256) => {
                if (actualSha256 !== currentUpdate.download.sha256) {
                  void fs.promises.rm(savePath, { force: true }).then(
                    () => reject(new Error("安装包校验失败，文件已删除")),
                    reject,
                  );
                  return;
                }

                verifiedUpdate = {
                  filePath: savePath,
                  sha256: currentUpdate.download.sha256,
                };
                mainWindow?.webContents.send(IPC_CHANNELS.updateDownloadProgress, {
                  percent: 100,
                  receivedBytes: item.getReceivedBytes(),
                  totalBytes: item.getTotalBytes(),
                });
                resolve({ status: "downloaded", filePath: savePath });
              }, reject);
            });
          };

          session.defaultSession.once("will-download", onWillDownload);
          try {
            session.defaultSession.downloadURL(parsedUrl.toString());
          } catch (error) {
            session.defaultSession.removeListener("will-download", onWillDownload);
            reject(error);
          }
        },
      );
    } finally {
      updateDownloadInProgress = false;
    }
  },
);

ipcMain.handle(IPC_CHANNELS.installUpdate, async () => {
  if (!verifiedUpdate) throw new Error("没有已通过校验的安装包");
  const resolvedPath = path.resolve(verifiedUpdate.filePath);
  const tempDirectory = path.resolve(app.getPath("temp"));
  if (
    !resolvedPath.startsWith(`${tempDirectory}${path.sep}`) ||
    !installerExtensions.has(path.extname(resolvedPath).toLowerCase())
  ) {
    throw new Error("安装包路径无效");
  }
  const installerExists = await fs.promises
    .stat(resolvedPath)
    .then((stats) => stats.isFile())
    .catch(() => false);
  if (!installerExists) throw new Error("安装包不存在，请重新下载");

  const actualSha256 = await calculateFileSha256(resolvedPath);
  if (actualSha256 !== verifiedUpdate.sha256) {
    verifiedUpdate = null;
    await fs.promises.rm(resolvedPath, { force: true });
    throw new Error("安装包在下载后发生变化，已阻止执行");
  }

  const errorMessage = await shell.openPath(resolvedPath);
  if (errorMessage) throw new Error(errorMessage);
  app.quit();
});

// IPC 通信处理
ipcMain.handle(
  IPC_CHANNELS.saveFile,
  async (
    _event,
    {
      filePath,
      content,
      expectedModifiedTime,
      force,
    }: {
      filePath: string | null;
      content: string;
      expectedModifiedTime: number | null;
      force?: boolean;
    },
  ) => {
    try {
      if (filePath) {
        const authorizedPath = assertAuthorizedPath(filePath);
        if (!force && expectedModifiedTime !== null) {
          const stats = await fs.promises.stat(authorizedPath);
          if (stats.mtimeMs !== expectedModifiedTime) {
            return {
              success: false,
              conflict: true,
              error: "文件已被其他程序修改",
            };
          }
        }
        await writeTextFileAtomically(authorizedPath, content);
        const stats = await fs.promises.stat(authorizedPath);
        return {
          success: true,
          filePath: authorizedPath,
          modifiedTime: stats.mtimeMs,
        };
      } else {
        const result = await dialog.showSaveDialog(mainWindow!, {
          filters: [
            { name: "Markdown", extensions: ["md"] },
            { name: "所有文件", extensions: ["*"] },
          ],
        });
        if (!result.canceled && result.filePath) {
          await writeTextFileAtomically(result.filePath, content);
          authorizeDocument(result.filePath);
          const stats = await fs.promises.stat(result.filePath);
          return {
            success: true,
            filePath: result.filePath,
            modifiedTime: stats.mtimeMs,
          };
        }
        return { success: false };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
);

ipcMain.handle(
  IPC_CHANNELS.showErrorMessage,
  async (_event, { title, message }: { title: string; message: string }) => {
    if (!mainWindow) return;
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title,
      message,
    });
  },
);

// 导出为 HTML：渲染进程已生成自包含的 HTML 文档，这里只负责选路径写文件。
ipcMain.handle(
  IPC_CHANNELS.exportHtml,
  async (_event, { html, suggestedName }: ExportHtmlData) => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${suggestedName}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, html, "utf-8");
    return { canceled: false, filePath: result.filePath };
  },
);

// 给异步操作加超时保护，避免某个环节异常卡死时导出窗口一直挂起。
// promise 提前完成时清理定时器，避免无意义的迟到 reject。
const withTimeout = <T>(promise: Promise<T>, errorMessage: string, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

// 导出为 PDF：用隐藏窗口加载导出的 HTML 后调用系统打印能力生成 PDF，
// 不影响当前编辑窗口；窗口在结束后无论成败都会销毁。
ipcMain.handle(
  IPC_CHANNELS.exportPdf,
  async (_event, { html, suggestedName }: ExportHtmlData) => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${suggestedName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        // 导出的 HTML 是纯静态内容，禁用脚本执行提高安全性。
        javascript: false,
      },
    });
    try {
      const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf-8").toString("base64")}`;
      // data URL 本身是即时加载的，但 HTML 内保留的 http(s) 图片会拖慢加载事件，
      // 因此加载和打印两个阶段都要有超时保护。
      await withTimeout(printWindow.loadURL(dataUrl), "PDF 页面加载超时（15 秒）", 15000);
      const pdfBuffer = await withTimeout(
        printWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
          margins: {
            top: 0.5,
            bottom: 0.5,
            left: 0.5,
            right: 0.5,
          },
        }),
        "PDF 生成超时（30 秒）",
        30000,
      );
      await fs.promises.writeFile(result.filePath, pdfBuffer);
      return { canceled: false, filePath: result.filePath };
    } finally {
      printWindow.destroy();
    }
  },
);

// 导出为 ZIP 包：渲染进程已经完成 Markdown 与图片的打包，这里只负责落盘。
ipcMain.handle(
  IPC_CHANNELS.exportZip,
  async (_event, { zipData, suggestedName }: ExportZipData) => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${suggestedName}.zip`,
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, Buffer.from(zipData));
    return { canceled: false, filePath: result.filePath };
  },
);

ipcMain.handle(IPC_CHANNELS.openFile, async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  return Promise.all(
    result.filePaths.map(async (filePath) => {
      authorizeDocument(filePath);
      const [content, stats] = await Promise.all([
        fs.promises.readFile(filePath, "utf-8"),
        fs.promises.stat(filePath),
      ]);
      return { filePath, content, modifiedTime: stats.mtimeMs };
    }),
  );
});

ipcMain.handle(IPC_CHANNELS.confirmExit, async (
  _event,
  { openCount, modifiedCount }: { openCount: number; modifiedCount: number },
) => {
  if (!mainWindow) return "cancel";
  if (modifiedCount === 0) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "关闭 XMD？",
      message: `当前打开了 ${openCount} 个文档。`,
      detail: "确认关闭全部标签页并退出程序吗？",
      buttons: ["关闭并退出", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return result.response === 0 ? "discard" : "cancel";
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "保存修改后退出？",
    message: `还有 ${modifiedCount} 个文档尚未保存。`,
    detail: "可以先保存全部文档，也可以放弃这些修改。",
    buttons: ["保存全部并退出", "放弃修改", "取消"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return (["save", "discard", "cancel"] as const)[result.response] ?? "cancel";
});

ipcMain.handle(IPC_CHANNELS.loadRecoveryDrafts, async () => {
  const draftPath = path.join(app.getPath("userData"), "recovery-drafts.json");
  try {
    const drafts = JSON.parse(await fs.promises.readFile(draftPath, "utf-8")) as Array<{
      filePath: string | null;
      content: string;
      savedContent: string;
      modifiedTime: number | null;
    }>;
    drafts.forEach((draft) => {
      if (draft.filePath) authorizeDocument(draft.filePath);
    });
    return drafts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
});

ipcMain.handle(IPC_CHANNELS.saveRecoveryDrafts, async (_event, drafts: Array<{
  filePath: string | null;
  content: string;
  savedContent: string;
  modifiedTime: number | null;
}>) => {
  // 仅持久化用户已经通过文件对话框授权过的路径，未命名草稿不包含路径。
  drafts.forEach((draft) => {
    if (draft.filePath) assertAuthorizedPath(draft.filePath);
  });
  const draftPath = path.join(app.getPath("userData"), "recovery-drafts.json");
  if (drafts.length === 0) {
    await fs.promises.rm(draftPath, { force: true });
    return;
  }
  await writeTextFileAtomically(draftPath, JSON.stringify(drafts));
});

// 更新日志直接使用版本清单中的 releases，客户端只需维护一个远程数据源。
ipcMain.handle(IPC_CHANNELS.getUpdateLogs, async () => {
  try {
    const manifest = await fetchUpdateManifest();
    return { success: true, releases: manifest.releases };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

registerWorkspaceIpc({ getMainWindow: () => mainWindow });

ipcMain.handle(IPC_CHANNELS.readFile, async (_event, filePath: string) => {
  try {
    const authorizedPath = assertAuthorizedPath(filePath);
    const [content, stats] = await Promise.all([
      fs.promises.readFile(authorizedPath, "utf-8"),
      fs.promises.stat(authorizedPath),
    ]);
    return { success: true, content, modifiedTime: stats.mtimeMs };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  IPC_CHANNELS.openDroppedFiles,
  async (_event, filePaths: string[]) => {
    // 拖放路径来自渲染页面，主进程仍需逐个校验扩展名和文件类型。
    const checkedPaths = await getFilePathsFromArguments(filePaths);
    return Promise.all(
      checkedPaths.map(async (filePath) => {
        authorizeDocument(filePath);
        const [content, stats] = await Promise.all([
          fs.promises.readFile(filePath, "utf-8"),
          fs.promises.stat(filePath),
        ]);
        return { filePath, content, modifiedTime: stats.mtimeMs };
      }),
    );
  },
);

ipcMain.handle(
  IPC_CHANNELS.getDirectoryName,
  async (_event, filePath: string) => {
    return path.dirname(assertAuthorizedPath(filePath));
  },
);

// 根据文档位置生成可迁移的相对地址；未保存文档使用标准本地文件地址。
function createEditorFileUrl(
  filePath: string,
  currentDocumentPath: string | null,
): string {
  if (!currentDocumentPath) return pathToFileURL(filePath).href;

  const relativePath = path.relative(
    path.dirname(currentDocumentPath),
    filePath,
  );
  return relativePath
    .split(path.sep)
    .map((part) =>
      part === ".." || part === "." ? part : encodeURIComponent(part),
    )
    .join("/");
}

// 同名附件使用递增编号保留两个版本，避免复制时静默覆盖已有文件。
async function getAvailableAttachmentPath(
  directoryPath: string,
  fileName: string,
): Promise<string> {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidatePath = path.join(directoryPath, fileName);
  let index = 1;
  while (
    await fs.promises
      .access(candidatePath)
      .then(() => true)
      .catch(() => false)
  ) {
    candidatePath = path.join(
      directoryPath,
      `${baseName} (${index})${extension}`,
    );
    index += 1;
  }
  return candidatePath;
}

// 使用文件流复制附件，才能向编辑区持续报告真实进度，而不是展示虚假的等待百分比。
async function copyAttachmentWithProgress(
  sourcePath: string,
  targetPath: string,
  requestId: string,
): Promise<void> {
  const sourceStats = await fs.promises.stat(sourcePath);
  let copiedBytes = 0;
  let lastReportedAt = 0;
  let bytesPerSecond = 0;
  const copyStartedAt = Date.now();

  const reportProgress = (
    status: AttachmentCopyProgress["status"],
    error?: string,
  ): void => {
    mainWindow?.webContents.send(IPC_CHANNELS.attachmentCopyProgress, {
      requestId,
      fileName: path.basename(sourcePath),
      copiedBytes,
      totalBytes: sourceStats.size,
      bytesPerSecond,
      status,
      error,
    } satisfies AttachmentCopyProgress);
  };

  reportProgress("copying");

  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(targetPath, { flags: "wx" });
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      readStream.destroy();
      writeStream.destroy();
      reject(error);
    };

    readStream.on("data", (chunk) => {
      copiedBytes += chunk.length;
      const now = Date.now();
      if (now - lastReportedAt >= 80 || copiedBytes === sourceStats.size) {
        // 使用累计字节和累计耗时计算平均速率，首个数据块后即可得到稳定的非零结果。
        const elapsedMilliseconds = Math.max(now - copyStartedAt, 1);
        bytesPerSecond = (copiedBytes * 1000) / elapsedMilliseconds;
        lastReportedAt = now;
        reportProgress("copying");
      }
    });
    readStream.on("error", fail);
    writeStream.on("error", fail);
    writeStream.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    readStream.pipe(writeStream);
  }).then(
    () => {
      copiedBytes = sourceStats.size;
      reportProgress("completed");
    },
    async (error: unknown) => {
      const message = error instanceof Error ? error.message : "复制附件失败";
      reportProgress("failed", message);
      // 失败时移除不完整的目标文件，避免 assets 中留下无法使用的副本。
      await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);
      throw error;
    },
  );
}

const editorImageMimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

// 编辑器只允许读取支持的图片格式，返回值仅用于页面预览，不会写入 Markdown。
async function readEditorImageDataUrl(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = editorImageMimeTypes[extension];
  if (!mimeType) throw new Error("不支持的图片格式");
  const content = await fs.promises.readFile(filePath);
  return `data:${mimeType};base64,${content.toString("base64")}`;
}

function resolveEditorFilePath(
  url: string,
  currentDocumentPath: string | null,
): string {
  if (currentDocumentPath) assertAuthorizedPath(currentDocumentPath);
  const resolvedPath = url.startsWith("file:")
    ? fileURLToPath(url)
    : path.resolve(
        currentDocumentPath ? path.dirname(currentDocumentPath) : process.cwd(),
        decodeURIComponent(url),
      );
  return assertAuthorizedPath(resolvedPath);
}

const videoMimeTypes: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
};

// Chromium 拖动视频进度时会请求指定字节区间，明确返回 206 才能可靠跳转到未缓冲位置。
async function createVideoResponse(
  request: Request,
  filePath: string,
): Promise<Response> {
  const stats = await fs.promises.stat(filePath);
  const fileSize = stats.size;
  const contentType =
    videoMimeTypes[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";
  const rangeHeader = request.headers.get("range");
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentType,
  };

  if (!rangeHeader) {
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ...commonHeaders, "Content-Length": String(fileSize) },
      });
    }
    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: { ...commonHeaders, "Content-Length": String(fileSize) },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, "Content-Range": `bytes */${fileSize}` },
    });
  }

  const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
  const requestedStart =
    suffixLength === null
      ? Number(match[1])
      : Math.max(0, fileSize - suffixLength);
  const requestedEnd =
    suffixLength === null && match[2] ? Number(match[2]) : fileSize - 1;
  const start = Math.max(0, requestedStart);
  const end = Math.min(requestedEnd, fileSize - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= fileSize
  ) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, "Content-Range": `bytes */${fileSize}` },
    });
  }

  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    },
  });
}

async function importEditorFile({
  filePath: sourcePath,
  kind,
  currentDocumentPath,
  attachmentHandling,
  requestId,
}: {
  filePath: string;
  kind: "image" | "video" | "file";
  currentDocumentPath: string | null;
  attachmentHandling?: "reference" | "copy-to-assets";
  requestId?: string;
}) {
  if (currentDocumentPath) assertAuthorizedPath(currentDocumentPath);
  const sourceStats = await fs.promises.stat(sourcePath);
  if (!sourceStats.isFile()) throw new Error("只能插入文件，暂不支持文件夹");

  const shouldCopyToAssets =
    kind === "image" ||
    (kind === "file" && attachmentHandling === "copy-to-assets");
  if (shouldCopyToAssets && !currentDocumentPath)
    throw new Error("复制资源前需要先保存当前文档");

  // 拖入和粘贴都使用同一套路径处理，确保生成的 Markdown 地址格式完全一致。
  let importedPath = sourcePath;
  if (shouldCopyToAssets && currentDocumentPath) {
    const assetsDirectory = path.join(
      path.dirname(currentDocumentPath),
      "assets",
    );
    await fs.promises.mkdir(assetsDirectory, { recursive: true });
    const directTargetPath = path.join(
      assetsDirectory,
      path.basename(sourcePath),
    );
    if (path.resolve(sourcePath) !== path.resolve(directTargetPath)) {
      importedPath = await getAvailableAttachmentPath(
        assetsDirectory,
        path.basename(sourcePath),
      );
      if (kind === "file" && requestId) {
        await copyAttachmentWithProgress(sourcePath, importedPath, requestId);
      } else {
        await fs.promises.copyFile(sourcePath, importedPath);
      }
    }
  }

  authorizeFile(sourcePath);
  authorizeFile(importedPath);
  const importedStats = await fs.promises.stat(importedPath);
  return {
    fileName: path.basename(importedPath),
    fileSize: importedStats.size,
    fileType: path.extname(importedPath).slice(1),
    url: createEditorFileUrl(importedPath, currentDocumentPath),
  };
}

ipcMain.handle(IPC_CHANNELS.importEditorFile, async (_event, options) =>
  importEditorFile(options),
);

ipcMain.handle(
  IPC_CHANNELS.selectEditorFile,
  async (
    _event,
    {
      kind,
      currentDocumentPath,
      attachmentHandling,
      requestId,
    }: {
      kind: "image" | "video" | "file";
      currentDocumentPath: string | null;
      attachmentHandling?: "reference" | "copy-to-assets";
      requestId?: string;
    },
  ) => {
    if (!mainWindow) return null;
    if (currentDocumentPath) assertAuthorizedPath(currentDocumentPath);

    const shouldCopyToAssets =
      kind === "image" ||
      (kind === "file" && attachmentHandling === "copy-to-assets");
    if (shouldCopyToAssets && !currentDocumentPath) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "请先保存文档",
        message: "复制资源前需要先保存当前文档",
        detail: "保存后，图片或附件将复制到文档同级的 assets 目录。",
      });
      return null;
    }

    const filters = {
      image: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
        },
      ],
      video: [
        { name: "视频", extensions: ["mp4", "webm", "ogg", "mov", "m4v"] },
      ],
      file: [{ name: "所有文件", extensions: ["*"] }],
    };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: filters[kind],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const selectedFilePath = result.filePaths[0];
    authorizeFile(selectedFilePath);
    let filePath = selectedFilePath;
    if (shouldCopyToAssets && currentDocumentPath) {
      const authorizedDocumentPath = assertAuthorizedPath(currentDocumentPath);
      const assetsDirectory = path.join(
        path.dirname(authorizedDocumentPath),
        "assets",
      );
      await fs.promises.mkdir(assetsDirectory, { recursive: true });
      const directTargetPath = path.join(
        assetsDirectory,
        path.basename(selectedFilePath),
      );
      if (path.resolve(selectedFilePath) !== path.resolve(directTargetPath)) {
        filePath = await getAvailableAttachmentPath(
          assetsDirectory,
          path.basename(selectedFilePath),
        );
        if (kind === "file" && requestId) {
          await copyAttachmentWithProgress(
            selectedFilePath,
            filePath,
            requestId,
          );
        } else {
          await fs.promises.copyFile(selectedFilePath, filePath);
        }
      }
    }
    authorizeFile(filePath);
    const stats = await fs.promises.stat(filePath);
    return {
      fileName: path.basename(filePath),
      fileSize: stats.size,
      fileType: path.extname(filePath).slice(1),
      url: createEditorFileUrl(filePath, currentDocumentPath),
    };
  },
);

// 附件可能使用相对路径或 file URL，这里统一还原为系统路径后交给默认应用打开。
ipcMain.handle(
  IPC_CHANNELS.openEditorFile,
  async (
    _event,
    {
      url,
      currentDocumentPath,
    }: { url: string; currentDocumentPath: string | null },
  ) => {
    const filePath = resolveEditorFilePath(url, currentDocumentPath);
    return shell.openPath(filePath);
  },
);

ipcMain.handle(
  IPC_CHANNELS.openLocalLink,
  async (
    _event,
    {
      url,
      currentDocumentPath,
    }: { url: string; currentDocumentPath: string | null },
  ) => {
    if (!currentDocumentPath) throw new Error("请先保存当前文档");
    const filePath = resolveEditorFilePath(url, currentDocumentPath);
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) throw new Error(errorMessage);
  },
);

ipcMain.handle(
  IPC_CHANNELS.saveEditorImage,
  async (
    _event,
    {
      bytes,
      mimeType,
      currentDocumentPath,
    }: {
      bytes: Uint8Array;
      mimeType: string;
      currentDocumentPath: string | null;
    },
  ) => {
    if (!mainWindow) return null;
    if (!currentDocumentPath) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "请先保存文档",
        message: "粘贴图片前需要先保存当前文档",
        detail: "保存后，图片将写入文档同级的 assets 目录。",
      });
      return null;
    }

    const extensionEntry = Object.entries(editorImageMimeTypes).find(
      ([, value]) => value === mimeType,
    );
    if (!extensionEntry) throw new Error("剪贴板中的图片格式不受支持");
    const authorizedDocumentPath = assertAuthorizedPath(currentDocumentPath);
    const assetsDirectory = path.join(
      path.dirname(authorizedDocumentPath),
      "assets",
    );
    await fs.promises.mkdir(assetsDirectory, { recursive: true });
    const targetPath = await getAvailableAttachmentPath(
      assetsDirectory,
      `粘贴图片${extensionEntry[0]}`,
    );
    await fs.promises.writeFile(targetPath, Buffer.from(bytes));
    authorizeFile(targetPath);
    const stats = await fs.promises.stat(targetPath);
    return {
      fileName: path.basename(targetPath),
      fileSize: stats.size,
      fileType: extensionEntry[0].slice(1),
      url: createEditorFileUrl(targetPath, currentDocumentPath),
    };
  },
);

ipcMain.handle(
  IPC_CHANNELS.readEditorImage,
  async (
    _event,
    {
      url,
      currentDocumentPath,
    }: { url: string; currentDocumentPath: string | null },
  ) => {
    if (/^https?:/i.test(url) || /^data:/i.test(url)) return url;
    return readEditorImageDataUrl(
      resolveEditorFilePath(url, currentDocumentPath),
    );
  },
);

ipcMain.handle(
  IPC_CHANNELS.readEditorFileBytes,
  async (
    _event,
    { url, currentDocumentPath }: { url: string; currentDocumentPath: string | null },
  ) => {
    const filePath = resolveEditorFilePath(url, currentDocumentPath);
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) throw new Error("资源文件不存在");
    return new Uint8Array(await fs.promises.readFile(filePath));
  },
);

ipcMain.handle(
  IPC_CHANNELS.editorFileExists,
  async (
    _event,
    {
      url,
      currentDocumentPath,
    }: { url: string; currentDocumentPath: string | null },
  ) => {
    const filePath = resolveEditorFilePath(url, currentDocumentPath);
    return fs.promises
      .stat(filePath)
      .then((stats) => stats.isFile())
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
  },
);

ipcMain.handle(
  IPC_CHANNELS.copyEditorImage,
  async (
    _event,
    {
      url,
      currentDocumentPath,
    }: { url: string; currentDocumentPath: string | null },
  ) => {
    // 系统剪贴板需要真实位图，不能只写入 Markdown 中的相对图片地址。
    let image;
    if (/^https?:/i.test(url)) {
      const response = await net.fetch(url);
      if (!response.ok) throw new Error(`下载图片失败：${response.status}`);
      image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    } else if (/^data:/i.test(url)) {
      image = nativeImage.createFromDataURL(url);
    } else {
      image = nativeImage.createFromPath(resolveEditorFilePath(url, currentDocumentPath));
    }

    if (image.isEmpty()) throw new Error("无法读取选中的图片");
    clipboard.writeImage(image);
  },
);

ipcMain.handle(
  IPC_CHANNELS.resolveEditorVideo,
  async (
    _event,
    {
      url,
      currentDocumentPath,
    }: { url: string; currentDocumentPath: string | null },
  ) => {
    if (/^https?:/i.test(url) || /^blob:/i.test(url) || /^data:/i.test(url))
      return url;
    const filePath = resolveEditorFilePath(url, currentDocumentPath);
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) throw new Error("视频文件不存在");
    return `xmd-media://video/?path=${encodeURIComponent(filePath)}`;
  },
);

// 应用准备就绪
app.whenReady().then(async () => {
  protocol.handle("xmd-media", async (request) => {
    const mediaUrl = new URL(request.url);
    const filePath = mediaUrl.searchParams.get("path");
    if (mediaUrl.host !== "video" || !filePath)
      return new Response("视频地址无效", { status: 400 });
    const authorizedPath = assertAuthorizedPath(filePath);
    return createVideoResponse(request, authorizedPath);
  });
  if (!hasSingleInstanceLock) return;

  queueFilesToOpen(await getFilePathsFromArguments(process.argv));
  createWindow();
  createMenu();

  // macOS 应用激活事件
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭事件
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
