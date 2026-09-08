import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import type { OpenDocument } from "../types";
import {
  getDocumentStats,
  getFileName,
  type DocumentStats,
} from "../utils/file";
import { useConfirmDialog } from "./useConfirmDialog";
import type { OpenFileData, RecoveryDraftData } from "../types/electron";
import { documentService } from "../services/documentService";
import { fileSystemService } from "../services/fileSystemService";
import { IPC_CHANNELS } from "../constants/ipcChannels";
import { useSettings } from "./useSettings";
import { useRecentFiles } from "./useRecentFiles";
import { matchesShortcut, parseShortcut } from "../utils/shortcuts";
import { diagnosticService } from "../services/diagnosticService";

export const useDocument = () => {
  const { requestConfirmation } = useConfirmDialog();
  const { settings } = useSettings();
  const { addRecentFiles, removeRecentFile, clearRecentFiles } = useRecentFiles();
  const documents = ref<OpenDocument[]>([]);
  const activeDocumentId = ref<number | null>(null);
  const documentSaveQueues = new Map<number, Promise<void>>();
  let nextDocumentId = 1;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let draftSaveQueue: Promise<void> = Promise.resolve();
  // 自动保存按文档维护定时器：内容持续变化时顺延，停止输入满间隔后才写入磁盘。
  const autoSaveTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // 记录“磁盘上存在外部程序改写的新版本、等待用户决定是否重新加载”的文档。
  // 按文档 id 标记，与 documents 解耦，避免污染触发自动保存/草稿的深度监听。
  const externalChangeDocuments = reactive(new Map<number, boolean>());
  let stopExternalFileListener: (() => void) | null = null;
  // 已注册到主进程监听的文件路径签名，仅在其真正变化时才重建监听。
  let watchedFilePathsSignature = "";

  const hasExternalChange = (documentId: number): boolean =>
    externalChangeDocuments.get(documentId) ?? false;

  // 忽略某文档的外部修改提示，直到下一次外部改写再次触发提醒。
  const dismissExternalChange = (documentId: number): void => {
    externalChangeDocuments.delete(documentId);
  };

  // 已打开且有保存路径的文档集合，交给主进程逐文件监听磁盘变化。
  const watchedFilePaths = computed(() =>
    documents.value
      .map((document) => document.filePath)
      .filter((filePath): filePath is string => filePath !== null),
  );

  // 集合变化时才重建主进程监听；内容输入不会改变文件路径，因此不会频繁重建。
  watch(
    watchedFilePaths,
    (filePaths) => {
      const signature = filePaths.join("\n");
      if (signature === watchedFilePathsSignature) return;
      watchedFilePathsSignature = signature;
      void fileSystemService.watchExternalFiles(filePaths);
    },
    { immediate: true },
  );

  // 收到外部改写通知后，读取磁盘最新 mtime 与 XMD 记录的 modifiedTime 比对。
  // 二者一致说明是 XMD 自己刚写入（保存后 modifiedTime 已同步），仅外部程序
  // 改写才视为外部变更，据此过滤自身写入避免误报。
  const handleExternalFileChanged = (filePath: string): void => {
    const document = documents.value.find(
      (item) => item.filePath === filePath,
    );
    if (!document) return;
    void documentService.readFile(filePath).then((result) => {
      // 处理期间文档可能已被关闭或另存为其他路径，丢弃迟到的结果。
      const latest = documents.value.find((item) => item.id === document.id);
      if (!latest || latest.filePath !== filePath) return;
      if (!result.success || result.modifiedTime === undefined) return;
      if (result.modifiedTime === latest.modifiedTime) return;
      externalChangeDocuments.set(latest.id, true);
    });
  };

  // 重新加载磁盘最新内容；文档存在未保存修改时先让用户明确确认丢弃。
  const reloadExternalChange = async (documentId: number): Promise<void> => {
    const document = documents.value.find((item) => item.id === documentId);
    if (!document || !document.filePath) return;

    if (document.isModified) {
      const shouldReload = await requestConfirmation({
        title: "重新加载将丢弃未保存的修改？",
        message: `“${getDocumentTitle(document)}”在 XMD 中的修改尚未保存，重新加载将从磁盘载入最新内容并丢弃这些修改。`,
        confirmLabel: "重新加载",
        tone: "danger",
      });
      if (!shouldReload) return;
    }

    const result = await documentService.readFile(document.filePath);
    if (!result.success || result.content === undefined) {
      await documentService.showErrorMessage(
        "重新加载失败",
        result.error ?? "无法读取磁盘上的最新内容。",
      );
      return;
    }
    document.content = result.content;
    document.savedContent = result.content;
    document.modifiedTime = result.modifiedTime ?? document.modifiedTime;
    document.isModified = false;
    externalChangeDocuments.delete(document.id);
  };

  // 草稿必须严格按照触发顺序写入，避免较慢的旧快照覆盖较新的编辑内容。
  const enqueueDraftSave = (drafts: RecoveryDraftData[]): Promise<void> => {
    const saveTask = draftSaveQueue
      .catch(() => undefined)
      .then(() => documentService.saveRecoveryDrafts(drafts));

    // 队列本身保持可继续执行，当前调用仍返回原始任务供退出流程检查结果。
    draftSaveQueue = saveTask.catch((error: unknown) => {
      console.error("保存恢复草稿失败:", error);
    });
    return saveTask;
  };

  const currentDocument = computed(
    () =>
      documents.value.find(
        (document) => document.id === activeDocumentId.value,
      ) ?? null,
  );
  const currentContent = computed(() => currentDocument.value?.content ?? "");
  const currentFilePath = computed(
    () => currentDocument.value?.filePath ?? null,
  );
  const displayTitle = computed(() => getDocumentTitle(currentDocument.value));
  const isDocumentOpen = computed(() => currentDocument.value !== null);
  const isModified = computed(() => currentDocument.value?.isModified ?? false);
  const documentStats = ref<DocumentStats>({
    lineCount: 0,
    characterCount: 0,
  });
  let documentStatsTimer: ReturnType<typeof setTimeout> | null = null;

  // 只提取恢复草稿真正依赖的字段，避免标签激活等无关状态变化触发深度遍历。
  const recoveryDraftSnapshot = computed(() =>
    documents.value.map(
      ({ filePath, content, savedContent, modifiedTime, isModified }) => ({
        filePath,
        content,
        savedContent,
        modifiedTime,
        isModified,
      }),
    ),
  );

  // 全文统计包含多次字符串扫描，延后到编辑器完成当前渲染后再执行。
  // 连续输入期间只统计最后一版内容，避免每次按键都阻塞编辑器。
  watch(
    currentContent,
    (content) => {
      if (documentStatsTimer) clearTimeout(documentStatsTimer);
      documentStatsTimer = setTimeout(() => {
        documentStats.value = getDocumentStats(content);
        documentStatsTimer = null;
      }, 220);
    },
    { immediate: true, flush: "post" },
  );

  // 只保存尚未落盘的内容；正常保存或主动放弃后，对应草稿会自动移除。
  watch(
    recoveryDraftSnapshot,
    (currentDocuments) => {
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(() => {
        const drafts: RecoveryDraftData[] = currentDocuments
          .filter((document) => document.isModified)
          .map(({ filePath, content, savedContent, modifiedTime }) => ({
            filePath,
            content,
            savedContent,
            modifiedTime,
          }));
        void enqueueDraftSave(drafts).catch(() => undefined);
        draftSaveTimer = null;
      }, 800);
    },
    { deep: true },
  );

  const restoreRecoveryDrafts = async (): Promise<void> => {
    const drafts = await documentService.loadRecoveryDrafts();
    drafts.forEach((draft) => {
      const document: OpenDocument = {
        id: nextDocumentId++,
        filePath: draft.filePath,
        content: draft.content,
        savedContent: draft.savedContent,
        modifiedTime: draft.modifiedTime,
        isModified: true,
      };
      documents.value.push(document);
    });
    const lastDocument = documents.value.at(-1);
    if (lastDocument) activateDocument(lastDocument.id);
  };

  // 文件名统一在这里处理，标签栏和当前文档标题会保持一致。
  const getDocumentTitle = (document: OpenDocument | null): string =>
    getFileName(document?.filePath ?? null);

  const activateDocument = (documentId: number): void => {
    const document = documents.value.find((item) => item.id === documentId);
    if (!document) return;

    activeDocumentId.value = document.id;
  };

  // 同一个路径只保留一个标签；再次打开时直接切换到已有标签，避免覆盖未保存内容。
  const applyOpenedFile = (file: OpenFileData): void => {
    const openedDocument = documents.value.find(
      (document) => document.filePath === file.filePath,
    );
    if (openedDocument) {
      activateDocument(openedDocument.id);
      return;
    }

    const document: OpenDocument = {
      id: nextDocumentId++,
      filePath: file.filePath,
      content: file.content,
      savedContent: file.content,
      modifiedTime: file.modifiedTime,
      isModified: false,
    };
    documents.value.push(document);
    activateDocument(document.id);
    // 用户打开过的文件记入最近列表，欢迎页和文件菜单可快速返回。
    void addRecentFiles([file.filePath]);
  };

  // 批量打开时先创建全部标签，最后只渲染一次编辑器内容。
  // 这样选择多个大文件不会在同一帧内反复解析 Markdown。
  const applyOpenedFiles = (files: OpenFileData[]): void => {
    if (files.length === 0) return;

    let lastDocumentId: number | null = null;
    files.forEach((file) => {
      const openedDocument = documents.value.find(
        (document) => document.filePath === file.filePath,
      );
      if (openedDocument) {
        lastDocumentId = openedDocument.id;
        return;
      }

      const document: OpenDocument = {
        id: nextDocumentId++,
        filePath: file.filePath,
        content: file.content,
        savedContent: file.content,
        modifiedTime: file.modifiedTime,
        isModified: false,
      };
      documents.value.push(document);
      lastDocumentId = document.id;
    });

    if (lastDocumentId !== null) activateDocument(lastDocumentId);
    // 批量打开与单个打开统一记录最近列表，重复路径由主进程按序去重置顶。
    void addRecentFiles(files.map((file) => file.filePath));
  };

  const handleContentUpdate = (content: string): void => {
    const document = currentDocument.value;
    if (!document || document.content === content) return;

    document.content = content;
    // 撤销到最近一次保存的内容时，立即清除标签页和状态栏的未保存标记。
    document.isModified = document.content !== document.savedContent;
  };

  const handleNewFile = (): void => {
    const document: OpenDocument = {
      id: nextDocumentId++,
      filePath: null,
      content: "",
      savedContent: "",
      modifiedTime: null,
      isModified: false,
    };
    documents.value.push(document);
    activateDocument(document.id);
  };

  const reorderDocument = (
    sourceDocumentId: number,
    targetDocumentId: number | null,
    placeAfter: boolean,
  ): void => {
    const sourceIndex = documents.value.findIndex(
      (document) => document.id === sourceDocumentId,
    );
    if (sourceIndex < 0) return;

    const [sourceDocument] = documents.value.splice(sourceIndex, 1);
    if (targetDocumentId === null) {
      documents.value.push(sourceDocument);
      return;
    }

    const targetIndex = documents.value.findIndex(
      (document) => document.id === targetDocumentId,
    );
    if (targetIndex < 0) {
      documents.value.splice(sourceIndex, 0, sourceDocument);
      return;
    }

    documents.value.splice(targetIndex + (placeAfter ? 1 : 0), 0, sourceDocument);
  };

  const closeDocument = async (documentId: number): Promise<void> => {
    const documentIndex = documents.value.findIndex(
      (document) => document.id === documentId,
    );
    if (documentIndex < 0) return;

    const document = documents.value[documentIndex];
    // 未保存内容必须由用户明确确认，避免关闭标签时误丢编辑结果。
    if (document.isModified) {
      const shouldClose = await requestConfirmation({
        title: "关闭未保存的文档？",
        message: `“${getDocumentTitle(document)}”中的修改尚未保存，关闭后将无法恢复。`,
        confirmLabel: "放弃修改",
        tone: "danger",
      });
      if (!shouldClose) return;
    }

    documents.value.splice(documentIndex, 1);
    if (activeDocumentId.value !== documentId) return;

    const nextDocument =
      documents.value[documentIndex] ?? documents.value[documentIndex - 1];
    if (nextDocument) {
      activateDocument(nextDocument.id);
    } else {
      activeDocumentId.value = null;
    }
  };

  const closeOtherDocuments = async (documentId: number): Promise<void> => {
    const documentToKeep = documents.value.find(
      (document) => document.id === documentId,
    );
    if (!documentToKeep) return;

    const documentsToClose = documents.value.filter(
      (document) => document.id !== documentId,
    );
    const modifiedCount = documentsToClose.filter(
      (document) => document.isModified,
    ).length;
    if (modifiedCount > 0) {
      const shouldClose = await requestConfirmation({
        title: "关闭其他标签页？",
        message: `其他标签页中有 ${modifiedCount} 个文档尚未保存，关闭后修改将无法恢复。`,
        confirmLabel: "关闭其他标签页",
        tone: "danger",
      });
      if (!shouldClose) return;
    }

    documents.value = [documentToKeep];
    activateDocument(documentToKeep.id);
  };

  const closeAllDocuments = async (): Promise<void> => {
    const modifiedCount = documents.value.filter(
      (document) => document.isModified,
    ).length;
    if (modifiedCount > 0) {
      const shouldClose = await requestConfirmation({
        title: "关闭所有标签页？",
        message: `有 ${modifiedCount} 个文档尚未保存，关闭后修改将无法恢复。`,
        confirmLabel: "关闭所有标签页",
        tone: "danger",
      });
      if (!shouldClose) return;
    }

    documents.value = [];
    activeDocumentId.value = null;
  };

  const handleOpenFile = async (): Promise<void> => {
    const files = await documentService.openFiles();
    if (files) applyOpenedFiles(files);
  };

  const handleDroppedFiles = async (files: File[]): Promise<void> => {
    const supportedExtensions = [".md", ".markdown", ".txt"];
    const supportedFiles = files.filter((file) =>
      supportedExtensions.some((extension) =>
        file.name.toLowerCase().endsWith(extension),
      ),
    );
    const unsupportedFiles = files.filter((file) => !supportedFiles.includes(file));

    if (unsupportedFiles.length > 0) {
      await documentService.showErrorMessage(
        "无法打开部分文件",
        `仅支持 .md、.markdown 和 .txt 文件：\n${unsupportedFiles.map((file) => file.name).join("\n")}`,
      );
    }

    // Electron 官方接口仅为系统文件返回真实路径，网页创建的 File 会返回空字符串。
    const filePaths = supportedFiles
      .map((file) => window.electronAPI.getPathForFile(file))
      .filter((filePath): filePath is string => Boolean(filePath));
    if (filePaths.length === 0) return;

    const openedFiles = await documentService.openDroppedFiles(filePaths);
    applyOpenedFiles(openedFiles);
  };

  const handleOpenFileFromSidebar = async (filePath: string): Promise<void> => {
    const openedDocument = documents.value.find(
      (document) => document.filePath === filePath,
    );
    if (openedDocument) {
      activateDocument(openedDocument.id);
      return;
    }

    const result = await documentService.readFile(filePath);
    if (!result.success || result.content === undefined) {
      console.error("打开文件失败:", result.error);
      await documentService.showErrorMessage(
        "无法打开文档",
        result.error ?? "文件读取失败，请检查文件是否存在以及当前账号是否有读取权限。",
      );
      return;
    }
    const fileData: OpenFileData = {
      filePath,
      content: result.content,
      modifiedTime: result.modifiedTime ?? 0,
    };
    applyOpenedFile(fileData);
  };

  // 从欢迎页或文件菜单打开最近文件；文件已被移动或删除时自动移出列表。
  const handleOpenRecentFile = async (filePath: string): Promise<void> => {
    const openedDocument = documents.value.find(
      (document) => document.filePath === filePath,
    );
    if (openedDocument) {
      activateDocument(openedDocument.id);
      return;
    }

    const result = await documentService.readFile(filePath);
    if (!result.success || result.content === undefined) {
      console.error("打开最近文件失败:", result.error);
      await removeRecentFile(filePath);
      await documentService.showErrorMessage(
        "无法打开文档",
        result.error ?? "文件读取失败，请检查文件是否存在以及当前账号是否有读取权限。",
      );
      return;
    }
    const fileData: OpenFileData = {
      filePath,
      content: result.content,
      modifiedTime: result.modifiedTime ?? 0,
    };
    applyOpenedFile(fileData);
  };

  const performDocumentSave = async (
    document: OpenDocument,
    saveAs: boolean,
    force = false,
  ): Promise<boolean> => {
    // 保存期间仍可能继续输入，因此用本次实际写入的内容判断保存后是否还有改动。
    const savedContent = document.content;
    const result = await documentService.saveFile({
      filePath: saveAs ? null : document.filePath,
      content: savedContent,
      expectedModifiedTime: saveAs ? null : document.modifiedTime,
      force,
    });
    if (result.conflict) {
      const shouldOverwrite = await requestConfirmation({
        title: "覆盖磁盘上的文件？",
        message: `“${getDocumentTitle(document)}”已被其他程序修改。继续保存将覆盖磁盘上的新内容。`,
        confirmLabel: "继续覆盖",
        tone: "danger",
      });
      // 冲突确认期间用户可能切换标签，因此必须继续保存最初捕获的文档。
      if (shouldOverwrite) return performDocumentSave(document, saveAs, true);
      return false;
    }
    if (!result.success) {
      if (result.error) {
        console.error("保存文件失败:", result.error);
        await documentService.showErrorMessage("无法保存文档", result.error);
      }
      return false;
    }

    document.filePath = result.filePath ?? null;
    document.savedContent = savedContent;
    document.modifiedTime = result.modifiedTime ?? document.modifiedTime;
    document.isModified = document.content !== document.savedContent;
    // 保存成功（含覆盖外部改写）后，磁盘已是当前内容，清除对应的外部修改提示。
    externalChangeDocuments.delete(document.id);
    return true;
  };

  const closeDocumentsOnSide = async (
    documentId: number,
    side: "left" | "right",
  ): Promise<void> => {
    const currentIndex = documents.value.findIndex(
      (document) => document.id === documentId,
    );
    if (currentIndex < 0) return;

    const documentsToClose = documents.value.filter((_, index) =>
      side === "left" ? index < currentIndex : index > currentIndex,
    );
    const modifiedCount = documentsToClose.filter(
      (document) => document.isModified,
    ).length;
    if (modifiedCount > 0) {
      const direction = side === "left" ? "左侧" : "右侧";
      const shouldClose = await requestConfirmation({
        title: `关闭${direction}标签页？`,
        message: `${direction}标签页中有 ${modifiedCount} 个文档尚未保存，关闭后修改将无法恢复。`,
        confirmLabel: `关闭${direction}标签页`,
        tone: "danger",
      });
      if (!shouldClose) return;
    }

    const documentIdsToClose = new Set(
      documentsToClose.map((document) => document.id),
    );
    documents.value = documents.value.filter(
      (document) => !documentIdsToClose.has(document.id),
    );
    activateDocument(documentId);
  };

  const closeLeftDocuments = (documentId: number): Promise<void> =>
    closeDocumentsOnSide(documentId, "left");

  const closeRightDocuments = (documentId: number): Promise<void> =>
    closeDocumentsOnSide(documentId, "right");

  const closeSavedDocuments = (): void => {
    const activeIndex = documents.value.findIndex(
      (document) => document.id === activeDocumentId.value,
    );
    const activeDocumentWasSaved = currentDocument.value?.isModified === false;

    // 只移除已经落盘的标签，未保存内容无需确认且始终保留。
    documents.value = documents.value.filter((document) => document.isModified);
    if (!activeDocumentWasSaved) return;

    const nextDocument =
      documents.value[activeIndex] ?? documents.value[documents.value.length - 1];
    if (nextDocument) {
      activateDocument(nextDocument.id);
    } else {
      activeDocumentId.value = null;
    }
  };

  // 同一文档的保存严格按触发顺序执行，避免多个写入互相覆盖或产生虚假冲突。
  // 手动保存与自动保存共用该入口，冲突检测和原子写入对两种方式同样生效。
  const saveDocument = async (
    document: OpenDocument,
    saveAs = false,
  ): Promise<boolean> => {
    const previousSave = documentSaveQueues.get(document.id) ?? Promise.resolve();
    let saved = false;
    const queuedSave = previousSave
      .catch(() => undefined)
      .then(async () => {
        saved = await performDocumentSave(document, saveAs);
      });
    documentSaveQueues.set(document.id, queuedSave);

    try {
      await queuedSave;
    } finally {
      if (documentSaveQueues.get(document.id) === queuedSave) {
        documentSaveQueues.delete(document.id);
      }
    }
    return saved;
  };

  const saveFile = (saveAs = false): Promise<boolean> => {
    const document = currentDocument.value;
    if (!document) return Promise.resolve(false);
    return saveDocument(document, saveAs);
  };

  // 自动保存只针对已经有保存路径的文档，未命名文档仍需用户手动选择保存位置。
  // 定时器在文档内容变化时顺延，避免输入过程中反复写入磁盘。
  watch(
    documents,
    () => {
      if (!settings.autoSave) return;
      for (const document of documents.value) {
        if (!document.isModified || !document.filePath) continue;
        const existingTimer = autoSaveTimers.get(document.id);
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
          autoSaveTimers.delete(document.id);
          void saveDocument(document);
        }, settings.autoSaveInterval * 1000);
        autoSaveTimers.set(document.id, timer);
      }
    },
    { deep: true },
  );

  // 关闭自动保存时取消所有待执行的保存，避免开关刚关闭仍继续写盘。
  watch(
    () => settings.autoSave,
    (autoSaveEnabled) => {
      if (autoSaveEnabled) return;
      for (const timer of autoSaveTimers.values()) clearTimeout(timer);
      autoSaveTimers.clear();
    },
  );

  const handleWindowCloseRequest = async (): Promise<void> => {
    const modifiedDocuments = documents.value.filter((document) => document.isModified);
    if (documents.value.length > 1 || modifiedDocuments.length > 0) {
      const choice = await documentService.confirmExit(
        documents.value.length,
        modifiedDocuments.length,
      );
      if (choice === "cancel") return;
      if (choice === "save") {
        // 顺序保存可以逐一为无标题文档选择位置；任何一次取消都会终止退出。
        for (const document of modifiedDocuments) {
          activateDocument(document.id);
          const saved = await saveFile(false);
          if (!saved || document.isModified) return;
        }
      }
    }
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    // 清理操作也进入同一队列，确保不会被尚未结束的旧草稿写入重新覆盖。
    await enqueueDraftSave([]);
    documentService.confirmWindowClose();
  };

  // 编辑器获得焦点时也直接响应保存快捷键，避免快捷键被富文本编辑器拦截。
  const handleSaveShortcut = (event: KeyboardEvent): void => {
    // 设置页录制快捷键时，焦点位于对话框内部，这里直接跳过避免误触发保存。
    if ((event.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return;
    if (event.repeat) return;

    const saveShortcut = settings.shortcuts.saveFile;
    if (!saveShortcut) return;
    const parsed = parseShortcut(saveShortcut);
    if (!parsed) return;
    // 默认组合不含 Shift 时，额外按下 Shift 表示“另存为”，与菜单行为保持一致。
    const ignoreShift = !parsed.shift;
    if (!matchesShortcut(event, saveShortcut, { ignoreShift })) return;

    event.preventDefault();
    event.stopPropagation();
    void saveFile(ignoreShift && event.shiftKey);
  };

  onMounted(async () => {
    documentService.onNewFile(handleNewFile);
    // 主进程会连续发送多选文件，把同一轮事件合并后只激活最后一个文件。
    let pendingMenuFiles: OpenFileData[] = [];
    let menuFilesScheduled = false;
    documentService.onOpenFile((file: OpenFileData) => {
      pendingMenuFiles.push(file);
      if (menuFilesScheduled) return;

      menuFilesScheduled = true;
      queueMicrotask(() => {
        const files = pendingMenuFiles;
        pendingMenuFiles = [];
        menuFilesScheduled = false;
        applyOpenedFiles(files);
      });
    });
    documentService.onSaveFile(() => saveFile());
    documentService.onSaveAsFile(() => saveFile(true));
    documentService.onOpenRecentFile((filePath) => {
      void handleOpenRecentFile(filePath);
    });
    documentService.onClearRecentFiles(() => {
      void clearRecentFiles();
    });
    documentService.onWindowCloseRequest(handleWindowCloseRequest);
    window.addEventListener("keydown", handleSaveShortcut, true);

    // 监听外部程序对已打开文档的改写，用于展示“重新加载”横幅。
    stopExternalFileListener = fileSystemService.onExternalFileChanged(
      handleExternalFileChanged,
    );

    let initializationError: unknown = null;
    try {
      // 监听器注册后立即完成握手，再恢复草稿和启动文件，主进程可安全发送后续事件。
      const startupFiles = await documentService.notifyRendererReady();
      await restoreRecoveryDrafts();
      applyOpenedFiles(startupFiles);
      await nextTick();
      // nextTick 只表示 Vue 已更新 DOM，浏览器此时可能还没有把文档画面提交给窗口。
      // 等待下一帧完成绘制后再显示主窗口，避免先闪出欢迎页再切换到目标文档。
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => window.setTimeout(resolve, 0));
      });
    } catch (error) {
      initializationError = error;
      console.error("初始化文档失败:", error);
      diagnosticService.error("startup.document-error", error);
    } finally {
      // 初始化成功或失败都必须结束启动阶段，否则主窗口会一直保持隐藏。
      documentService.notifyRendererViewReady();
    }

    if (initializationError) {
      const message =
        initializationError instanceof Error
          ? initializationError.message
          : "文档初始化失败";
      await documentService.showErrorMessage("无法完成文档初始化", message);
    }
  });

  onUnmounted(() => {
    if (documentStatsTimer) clearTimeout(documentStatsTimer);
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    for (const timer of autoSaveTimers.values()) clearTimeout(timer);
    autoSaveTimers.clear();
    stopExternalFileListener?.();
    // 停止对已打开文件的监听，避免组件销毁后主进程仍收到外部变化通知。
    void fileSystemService.watchExternalFiles([]);
    documentService.removeListeners(IPC_CHANNELS.menuNewFile);
    documentService.removeListeners(IPC_CHANNELS.menuOpenFile);
    documentService.removeListeners(IPC_CHANNELS.menuSaveFile);
    documentService.removeListeners(IPC_CHANNELS.menuSaveAsFile);
    documentService.removeListeners(IPC_CHANNELS.menuOpenRecentFile);
    documentService.removeListeners(IPC_CHANNELS.menuClearRecentFiles);
    documentService.removeListeners(IPC_CHANNELS.requestWindowClose);
    window.removeEventListener("keydown", handleSaveShortcut, true);
  });

  return {
    documents,
    activeDocumentId,
    currentContent,
    currentFilePath,
    displayTitle,
    isDocumentOpen,
    isModified,
    documentStats,
    activateDocument,
    closeDocument,
    closeOtherDocuments,
    closeLeftDocuments,
    closeRightDocuments,
    closeSavedDocuments,
    closeAllDocuments,
    getDocumentTitle,
    handleContentUpdate,
    handleNewFile,
    reorderDocument,
    handleOpenFile,
    handleDroppedFiles,
    handleOpenFileFromSidebar,
    handleOpenRecentFile,
    saveFile,
    applyOpenedFile,
    applyOpenedFiles,
    hasExternalChange,
    dismissExternalChange,
    reloadExternalChange,
  };
};
