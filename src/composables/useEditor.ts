import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useEditor as useTiptapEditor } from "@tiptap/vue-3";
import { Extension, type Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import {
  handleCodeBlockSelectAll,
  handleCodeBlockTab,
} from "../modules/codeBlockKeyboard";
import {
  getCellContentEndPosition,
  handleTableSelectAll,
} from "../modules/tableInteraction";
import { sectionCollapseKey } from "../extensions/SectionCollapse";
import { createEditorExtensions } from "../editor/editorExtensions";
import { shouldEmitMarkdownUpdate } from "../editor/documentStructureExtensions";
import { mediaService } from "../services/mediaService";
import {
  filterSlashCommands,
  slashCommandGroups,
  type SlashCommand,
  type SlashRange,
} from "../modules/slashCommands";
import { emojis, filterEmojis, type EmojiItem } from "../modules/emojis";
import { useSettings } from "./useSettings";


interface BlockPosition {
  position: number;
  element: HTMLElement;
  isHeading: boolean;
}

interface DropIndicator {
  position: number;
  left: number;
  top: number;
  width: number;
}


export const useMarkdownEditor = (
  getContent: () => string,
  emit?: (event: "update:content", content: string) => void,
  getCurrentDocumentPath?: () => string | null,
  getIsActive: () => boolean = () => true,
  onOpenAiWriter?: (range: SlashRange) => void,
) => {
  const { settings } = useSettings();
  const slashMenuVisible = ref(false);
  const slashMenu = ref<HTMLElement | null>(null);
  const slashQuery = ref("");
  const slashRange = ref<SlashRange | null>(null);
  const selectedCommandIndex = ref(0);
  const slashMenuPosition = ref({ left: 0, top: 0 });
  const activeBlock = ref<BlockPosition | null>(null);
  const blockControlVisible = ref(false);
  const blockMenuVisible = ref(false);
  const blockControlPosition = ref({ left: 0, top: 0 });
  const dropIndicator = ref<DropIndicator | null>(null);
  const draggedBlockPosition = ref<number | null>(null);
  const editorRenderVersion = ref(0);
  let lastEmittedMarkdown: string | null = null;
  let renderedDocumentPath = getCurrentDocumentPath?.() ?? null;
  const linkInsertVisible = ref(false);
  const linkInsertUrl = ref("");
  const linkInsertLabel = ref("");
  const linkInsertError = ref("");
  const linkInsertRange = ref<SlashRange | null>(null);
  // Emoji 选择器：grid 由斜杠命令打开，list 由冒号自动补全触发。
  const emojiMenuMode = ref<"grid" | "list" | null>(null);
  const emojiQuery = ref("");
  const emojiRange = ref<SlashRange | null>(null);
  const emojiSelectedIndex = ref(0);
  const emojiMenuPosition = ref({ left: 0, top: 0 });

  const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
  const videoExtensions = new Set(["mp4", "webm", "ogg", "mov", "m4v"]);

  const getFileExtension = (file: File): string =>
    file.name.split(".").pop()?.toLocaleLowerCase() ?? "";

  // 使用 Electron 官方接口读取拖入文件的真实路径，避免依赖已经移除的 File.path。
  const getNativeFilePath = (file: File): string =>
    window.electronAPI.getPathForFile(file);

  const getFileKind = (file: File): "image" | "video" | "file" => {
    const extension = getFileExtension(file);
    if (file.type.startsWith("image/") || imageExtensions.has(extension)) return "image";
    if (file.type.startsWith("video/") || videoExtensions.has(extension)) return "video";
    return "file";
  };

  // 系统文件和剪贴板位图最终都转换成编辑器已有的三种节点，不重复维护展示样式。
  async function insertExternalFiles(files: File[], insertPosition: number): Promise<void> {
    const content: Array<{ type: string; attrs?: Record<string, unknown> }> = [];

    for (const file of files) {
      const kind = getFileKind(file);
      const nativePath = getNativeFilePath(file);
      const showCopyProgress =
        Boolean(nativePath) &&
        kind === "file" &&
        settings.attachmentHandling === "copy-to-assets";
      const requestId = showCopyProgress ? crypto.randomUUID() : undefined;
      let transferInserted = false;

      const findTransferPosition = (): number | null => {
        if (!requestId || !editor.value) return null;
        let position: number | null = null;
        editor.value.state.doc.descendants((node, nodePosition) => {
          if (node.type.name === "attachmentTransfer" && node.attrs.requestId === requestId) {
            position = nodePosition;
            return false;
          }
          return position === null;
        });
        return position;
      };

      // 粘贴与拖入附件复用斜杠菜单相同的进度事件，避免后台复制时界面没有反馈。
      const removeProgressListener = requestId
        ? mediaService.onAttachmentCopyProgress((progress) => {
            if (progress.requestId !== requestId || !editor.value) return;
            if (!transferInserted) {
              transferInserted = true;
              editor.value.chain().focus().insertContentAt(insertPosition, [
                {
                  type: "attachmentTransfer",
                  attrs: {
                    requestId,
                    fileName: progress.fileName,
                    copiedBytes: progress.copiedBytes,
                    totalBytes: progress.totalBytes,
                    bytesPerSecond: progress.bytesPerSecond,
                    status: progress.status,
                    error: progress.error ?? "",
                  },
                },
                { type: "paragraph" },
              ]).run();
              return;
            }

            const position = findTransferPosition();
            if (position === null) return;
            editor.value.view.dispatch(
              editor.value.state.tr.setNodeMarkup(position, undefined, {
                ...editor.value.state.doc.nodeAt(position)?.attrs,
                copiedBytes: progress.copiedBytes,
                totalBytes: progress.totalBytes,
                bytesPerSecond: progress.bytesPerSecond,
                status: progress.status,
                error: progress.error ?? "",
              }),
            );
          })
        : null;
      try {
        const imported = nativePath
          ? await mediaService.importFile({
              filePath: nativePath,
              kind,
              currentDocumentPath: getCurrentDocumentPath?.() ?? null,
              attachmentHandling: settings.attachmentHandling,
              requestId,
            })
          : kind === "image"
            ? await mediaService.saveImage(
                new Uint8Array(await file.arrayBuffer()),
                file.type,
                getCurrentDocumentPath?.() ?? null,
              )
            : null;
        if (!imported) continue;

        const transferPosition = findTransferPosition();
        if (transferPosition !== null && editor.value) {
          const transferNode = editor.value.state.doc.nodeAt(transferPosition);
          if (transferNode) {
            editor.value.view.dispatch(
              editor.value.state.tr.replaceWith(
                transferPosition,
                transferPosition + transferNode.nodeSize,
                editor.value.schema.nodes.attachment.create({
                  fileName: imported.fileName,
                  fileSize: imported.fileSize,
                  fileType: imported.fileType,
                  url: imported.url,
                }),
              ),
            );
            continue;
          }
        }

        if (kind === "image") {
          content.push({ type: "image", attrs: { src: imported.url, alt: imported.fileName } });
        } else if (kind === "video") {
          content.push({ type: "video", attrs: { src: imported.url } });
        } else {
          content.push({
            type: "attachment",
            attrs: {
              fileName: imported.fileName,
              fileSize: imported.fileSize,
              fileType: imported.fileType,
              url: imported.url,
            },
          });
        }
      } catch (error) {
        console.error(`插入文件“${file.name}”失败:`, error);
        const message = error instanceof Error ? error.message : "无法读取该文件";
        await window.electronAPI.showErrorMessage("插入附件失败", `${file.name}\n${message}`);
      } finally {
        removeProgressListener?.();
      }
    }

    if (content.length === 0 || !editor.value) return;
    editor.value.chain().focus().insertContentAt(insertPosition, [
      ...content,
      { type: "paragraph" },
    ]).run();
  }

  // 搜索规则由斜杠命令模块统一管理，编辑器只维护当前输入状态。
  // 上下箭头按扁平数组索引导航，而面板按分组顺序渲染，两者可能不一致
  // （如“AI 实时编写”定义在命令数组末尾、却属于“扩展内容”组），
  // 因此按分组顺序排序，保证键盘选中顺序与视觉顺序一致。
  // 先复制一份再排序：空查询时 filterSlashCommands 返回的是源数组引用。
  const filteredCommands = computed(() =>
    [...filterSlashCommands(slashQuery.value)].sort(
      (a, b) => slashCommandGroups.indexOf(a.group) - slashCommandGroups.indexOf(b.group),
    ),
  );

  const commandGroups = computed(() =>
    slashCommandGroups.map((name) => ({
      name,
      commands: filteredCommands.value
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.group === name),
    })),
  );

  const slashMenuStyle = computed(() => ({
    left: `${slashMenuPosition.value.left}px`,
    top: `${slashMenuPosition.value.top}px`,
  }));

  // 冒号补全展示紧凑列表，斜杠命令的网格选择器在搜索时也使用同一过滤结果。
  const filteredEmojis = computed(() => filterEmojis(emojiQuery.value, 40));
  // 网格模式下未搜索时展示全部分类，由选择器组件按分类标签过滤。
  const emojiGridItems = computed(() =>
    emojiQuery.value ? filterEmojis(emojiQuery.value, 120) : emojis,
  );

  const emojiMenuStyle = computed(() => ({
    left: `${emojiMenuPosition.value.left}px`,
    top: `${emojiMenuPosition.value.top}px`,
  }));

  const blockControlStyle = computed(() => ({
    left: `${blockControlPosition.value.left}px`,
    top: `${blockControlPosition.value.top}px`,
  }));

  const blockMenuStyle = computed(() => ({
    left: `${blockControlPosition.value.left}px`,
    top: `${blockControlPosition.value.top + 34}px`,
  }));

  const dropIndicatorStyle = computed(() => ({
    left: `${dropIndicator.value?.left ?? 0}px`,
    top: `${dropIndicator.value?.top ?? 0}px`,
    width: `${dropIndicator.value?.width ?? 0}px`,
  }));

  const activeBlockCollapsed = computed(() => {
    editorRenderVersion.value;
    if (!editor.value || !activeBlock.value?.isHeading) return false;

    return (
      sectionCollapseKey
        .getState(editor.value.state)
        ?.collapsedPositions.has(activeBlock.value.position) ?? false
    );
  });

  const activeBlockIsFirst = computed(() => activeBlock.value?.position === 0);
  const activeBlockIsLast = computed(() => {
    if (!editor.value) return true;
    const range = getActiveBlockRange();
    return !range || range.to >= editor.value.state.doc.content.size;
  });

  const closeSlashMenu = (): void => {
    slashMenuVisible.value = false;
    slashQuery.value = "";
    slashRange.value = null;
    selectedCommandIndex.value = 0;
  };

  const refreshSlashMenu = (currentEditor: Editor): void => {
    const { selection } = currentEditor.state;
    if (!selection.empty) {
      closeSlashMenu();
      return;
    }

    const { $from } = selection;
    const textBeforeCursor = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      "\ufffc",
    );
    const match = textBeforeCursor.match(/(?:^|\s)\/([^\s/]*)$/);

    if (!match) {
      closeSlashMenu();
      return;
    }

    const query = match[1];
    const slashOffset = textBeforeCursor.length - query.length - 1;
    slashRange.value = {
      from: $from.start() + slashOffset,
      to: selection.from,
    };
    slashQuery.value = query;
    selectedCommandIndex.value = Math.min(
      selectedCommandIndex.value,
      Math.max(filteredCommands.value.length - 1, 0),
    );
    slashMenuVisible.value = true;

    // TipTap 更新 DOM 后再读取坐标，确保菜单稳定跟随当前输入光标。
    void nextTick(() => {
      const cursor = currentEditor.view.coordsAtPos(selection.from);
      // 菜单是否展示辅助说明会影响宽度，因此按实际渲染尺寸计算边缘位置。
      const menuWidth = slashMenu.value?.getBoundingClientRect().width ?? 220;
      const edgeGap = 12;
      const menuGap = 8;
      const menuHeight = slashMenu.value?.getBoundingClientRect().height ?? 260;
      const spaceBelowCursor = window.innerHeight - cursor.bottom - edgeGap;
      const top =
        spaceBelowCursor >= menuHeight + menuGap
          ? cursor.bottom + menuGap
          : cursor.top - menuHeight - menuGap;

      slashMenuPosition.value = {
        left: Math.max(
          edgeGap,
          Math.min(cursor.left, window.innerWidth - menuWidth - edgeGap),
        ),
        top: Math.max(
          edgeGap,
          Math.min(top, window.innerHeight - menuHeight - edgeGap),
        ),
      };
    });
  };

  // 滚动时让斜杠面板贴住光标：光标仍在可视区就重新贴位，滚出可视区就关闭面板，
  // 避免菜单悬空漂在正文上方。用 rAF 合并高频滚动事件，减少布局读取。
  let slashMenuScrollFrame = 0;
  const handleSlashMenuScroll = (): void => {
    if (!slashMenuVisible.value || !editor.value) return;
    if (slashMenuScrollFrame !== 0) return;
    slashMenuScrollFrame = requestAnimationFrame(() => {
      slashMenuScrollFrame = 0;
      if (!slashMenuVisible.value || !editor.value) return;
      const viewport = editor.value.view.dom.closest(".editor-scroll");
      const caret = editor.value.view.coordsAtPos(editor.value.state.selection.from);
      const rect = viewport?.getBoundingClientRect();
      if (!rect || caret.top < rect.top || caret.bottom > rect.bottom) {
        closeSlashMenu();
        return;
      }
      refreshSlashMenu(editor.value);
    });
  };

  const executeSlashCommand = (command: SlashCommand): void => {
    if (!editor.value || !slashRange.value) return;

    const range = { ...slashRange.value };
    closeSlashMenu();
    if (command.opensLinkForm) {
      linkInsertRange.value = range;
      linkInsertUrl.value = "";
      linkInsertLabel.value = "";
      linkInsertError.value = "";
      linkInsertVisible.value = true;
      return;
    }
    if (command.opensEmojiPicker) {
      openEmojiPicker(range);
      return;
    }
    if (command.opensAiWriter) {
      // 触发AI实时编写事件
      onOpenAiWriter?.(range);
      return;
    }
    if (!command.run) return;
    void command.run(
      editor.value,
      range,
      getCurrentDocumentPath?.() ?? null,
    );
  };

  const closeEmojiMenu = (): void => {
    emojiMenuMode.value = null;
    emojiQuery.value = "";
    emojiRange.value = null;
    emojiSelectedIndex.value = 0;
  };

  // 选择器面板关闭后把焦点还给编辑器，保证键盘继续用于写作。
  const cancelEmojiMenu = (): void => {
    closeEmojiMenu();
    editor.value?.commands.focus();
  };

  const positionEmojiMenu = (currentEditor: Editor, anchorPosition: number): void => {
    void nextTick(() => {
      const cursor = currentEditor.view.coordsAtPos(anchorPosition);
      const menuElement = document.querySelector<HTMLElement>("[data-emoji-picker]");
      const menuWidth = menuElement?.getBoundingClientRect().width ?? 320;
      const menuHeight = menuElement?.getBoundingClientRect().height ?? 320;
      const edgeGap = 12;
      const menuGap = 8;
      const spaceBelowCursor = window.innerHeight - cursor.bottom - edgeGap;
      const top =
        spaceBelowCursor >= menuHeight + menuGap
          ? cursor.bottom + menuGap
          : cursor.top - menuHeight - menuGap;

      emojiMenuPosition.value = {
        left: Math.max(
          edgeGap,
          Math.min(cursor.left, window.innerWidth - menuWidth - edgeGap),
        ),
        top: Math.max(
          edgeGap,
          Math.min(top, window.innerHeight - menuHeight - edgeGap),
        ),
      };
    });
  };

  const openEmojiPicker = (range: SlashRange): void => {
    if (!editor.value) return;
    emojiRange.value = range;
    emojiQuery.value = "";
    emojiSelectedIndex.value = 0;
    emojiMenuMode.value = "grid";
    positionEmojiMenu(editor.value, range.from);
  };

  const insertEmoji = (item: EmojiItem): void => {
    if (!editor.value || !emojiRange.value) return;
    const range = { ...emojiRange.value };
    closeEmojiMenu();
    // 删除冒号短代码或斜杠命令文本后插入纯文本 Emoji，序列化无需额外处理。
    editor.value.chain().focus().deleteRange(range).insertContent(item.emoji).run();
  };

  const scrollEmojiSelectedIntoView = (): void => {
    void nextTick(() => {
      document
        .querySelector("[data-emoji-picker] [data-emoji-selected]")
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  // 冒号补全：文本节点内的 :abc 触发紧凑建议列表，代码块与行内代码不参与。
  const refreshEmojiMenu = (currentEditor: Editor): void => {
    if (emojiMenuMode.value === "grid") return;
    const { selection } = currentEditor.state;
    if (!selection.empty || slashMenuVisible.value) {
      closeEmojiMenu();
      return;
    }

    const { $from } = selection;
    if (
      $from.parent.type.name === "codeBlock" ||
      $from.marks().some((mark) => mark.type.name === "code")
    ) {
      closeEmojiMenu();
      return;
    }

    const textBeforeCursor = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      "\ufffc",
    );
    const match = textBeforeCursor.match(/(?:^|\s):([^\s:]*)$/);
    if (!match) {
      closeEmojiMenu();
      return;
    }

    const query = match[1];
    const colonOffset = textBeforeCursor.length - query.length - 1;
    emojiRange.value = {
      from: $from.start() + colonOffset,
      to: selection.from,
    };
    emojiQuery.value = query;
    // 无匹配时不保留空列表，避免浮动面板挡住正文。
    if (filteredEmojis.value.length === 0) {
      closeEmojiMenu();
      return;
    }
    emojiSelectedIndex.value = Math.min(
      emojiSelectedIndex.value,
      Math.max(filteredEmojis.value.length - 1, 0),
    );
    emojiMenuMode.value = "list";
    positionEmojiMenu(currentEditor, selection.from);
  };

  // 冒号补全状态下接管方向键与回车，避免焦点离开编辑器。
  const handleEmojiMenuKeydown = (event: KeyboardEvent): boolean => {
    if (emojiMenuMode.value !== "list" || event.isComposing) return false;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredEmojis.value.length) {
        emojiSelectedIndex.value =
          (emojiSelectedIndex.value + 1) % filteredEmojis.value.length;
        scrollEmojiSelectedIntoView();
      }
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredEmojis.value.length) {
        emojiSelectedIndex.value =
          (emojiSelectedIndex.value - 1 + filteredEmojis.value.length) %
          filteredEmojis.value.length;
        scrollEmojiSelectedIntoView();
      }
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const item = filteredEmojis.value[emojiSelectedIndex.value];
      if (item) insertEmoji(item);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeEmojiMenu();
      return true;
    }

    return false;
  };

  const cancelLinkInsert = (): void => {
    linkInsertVisible.value = false;
    linkInsertRange.value = null;
    linkInsertError.value = "";
    editor.value?.commands.focus();
  };

  // 用户输入域名时自动补全网页协议，明确拒绝编辑器不支持打开的协议。
  const submitLinkInsert = (): void => {
    if (!editor.value || !linkInsertRange.value) return;
    const inputUrl = linkInsertUrl.value.trim();
    const label = linkInsertLabel.value.trim();
    if (!inputUrl || !label) {
      linkInsertError.value = "请填写链接地址和显示文字";
      return;
    }

    const isRelativeLink = /^(?:\.{1,2}\/|\/|#)/.test(inputUrl);
    if (isRelativeLink) {
      editor.value.chain().focus().deleteRange(linkInsertRange.value).insertContent({
        type: "text",
        text: label,
        marks: [{ type: "link", attrs: { href: inputUrl } }],
      }).run();
      linkInsertVisible.value = false;
      linkInsertRange.value = null;
      linkInsertError.value = "";
      return;
    }

    const normalizedUrl = /^[a-z][a-z\d+.-]*:/i.test(inputUrl) ? inputUrl : `https://${inputUrl}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      linkInsertError.value = "请输入有效的链接地址";
      return;
    }
    if (!["http:", "https:", "mailto:"].includes(parsedUrl.protocol)) {
      linkInsertError.value = "仅支持网页和邮箱链接";
      return;
    }

    editor.value.chain().focus().deleteRange(linkInsertRange.value).insertContent({
      type: "text",
      text: label,
      marks: [{ type: "link", attrs: { href: parsedUrl.toString() } }],
    }).run();
    linkInsertVisible.value = false;
    linkInsertRange.value = null;
    linkInsertError.value = "";
  };

  /** 将当前选中的命令项滚动到可视区域。 */
  const scrollSelectedIntoView = () => {
    nextTick(() => {
      const menu = slashMenu.value;
      if (!menu) return;
      const selected = menu.querySelector("[data-slash-selected]");
      selected?.scrollIntoView({ block: "nearest" });
    });
  };

  const handleSlashMenuKeydown = (event: KeyboardEvent): boolean => {
    if (!slashMenuVisible.value || event.isComposing) return false;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredCommands.value.length) {
        selectedCommandIndex.value =
          (selectedCommandIndex.value + 1) % filteredCommands.value.length;
        scrollSelectedIntoView();
      }
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredCommands.value.length) {
        selectedCommandIndex.value =
          (selectedCommandIndex.value - 1 + filteredCommands.value.length) %
          filteredCommands.value.length;
        scrollSelectedIntoView();
      }
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const command = filteredCommands.value[selectedCommandIndex.value];
      if (command) executeSlashCommand(command);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
      return true;
    }

    return false;
  };

  // 根据编辑器根节点的直接子元素定位顶层块，列表和表格内部操作仍由 TipTap 自己处理。
  const resolveTopLevelBlock = (
    target: EventTarget | null,
  ): BlockPosition | null => {
    if (!editor.value || !(target instanceof HTMLElement)) return null;

    const editorRoot = editor.value.view.dom;
    let blockElement: HTMLElement | null = target;
    while (blockElement && blockElement.parentElement !== editorRoot) {
      blockElement = blockElement.parentElement;
    }
    if (!blockElement) return null;

    const blockIndex = Array.from(editorRoot.children).indexOf(blockElement);
    if (blockIndex < 0 || blockIndex >= editor.value.state.doc.childCount)
      return null;

    let position = 0;
    for (let index = 0; index < blockIndex; index += 1) {
      position += editor.value.state.doc.child(index).nodeSize;
    }
    const node = editor.value.state.doc.child(blockIndex);

    return {
      position,
      element: blockElement,
      isHeading: node.type.name === "heading",
    };
  };

  const refreshBlockControlPosition = (): void => {
    if (
      !activeBlock.value ||
      !document.body.contains(activeBlock.value.element)
    ) {
      blockControlVisible.value = false;
      return;
    }

    const blockRect = activeBlock.value.element.getBoundingClientRect();
    const blockLineHeight = Number.parseFloat(
      window.getComputedStyle(activeBlock.value.element).lineHeight,
    );
    const isAttachment = activeBlock.value.element.matches(
      "[data-xmd-attachment]",
    );
    // 附件是固定高度的整体卡片，拖拽柄需要对齐卡片中心；文本块仍按首行居中。
    const blockVisualCenter = isAttachment
      ? blockRect.height / 2
      : activeBlock.value.element.tagName === "HR"
        ? 0
        : blockLineHeight / 2;
    const controlCenter = blockRect.top + blockVisualCenter;
    const editorViewport = editor.value?.view.dom.closest(".editor-scroll");
    const viewportRect = editorViewport?.getBoundingClientRect();

    // 拖拽手柄使用视口坐标定位，必须主动限制在编辑区内，避免滚动后覆盖标签栏和菜单栏。
    if (
      !viewportRect ||
      controlCenter < viewportRect.top ||
      controlCenter > viewportRect.bottom
    ) {
      blockControlVisible.value = false;
      return;
    }

    // 操作轨道只保留六点手柄和标题折叠，新增等低频操作统一收进菜单。
    const controlWidth = activeBlock.value.isHeading ? 52 : 24;
    blockControlPosition.value = {
      left: Math.max(8, blockRect.left - controlWidth - 6),
      // 文本按首行、附件按整张卡片的视觉中心定位。
      top: controlCenter - 14,
    };
  };

  const handleEditorMouseMove = (event: MouseEvent): void => {
    if (draggedBlockPosition.value !== null || blockMenuVisible.value) return;

    const block = resolveTopLevelBlock(event.target);
    if (!block) return;

    activeBlock.value = block;
    blockControlVisible.value = true;
    refreshBlockControlPosition();
  };

  const handleEditorMouseLeave = (event: MouseEvent): void => {
    const nextElement = event.relatedTarget as HTMLElement | null;
    if (nextElement?.closest("[data-block-control], [data-block-menu]")) return;
    if (blockMenuVisible.value) return;
    if (draggedBlockPosition.value === null) blockControlVisible.value = false;
  };

  const handleBlockControlLeave = (event: MouseEvent): void => {
    const nextElement = event.relatedTarget as HTMLElement | null;
    if (nextElement?.closest("[data-block-menu]")) return;
    if (nextElement && editor.value?.view.dom.contains(nextElement)) return;
    if (blockMenuVisible.value) return;
    if (draggedBlockPosition.value === null) blockControlVisible.value = false;
  };

  const toggleBlockMenu = (): void => {
    blockMenuVisible.value = !blockMenuVisible.value;
    blockControlVisible.value = true;
  };

  const closeBlockMenu = (): void => {
    blockMenuVisible.value = false;
  };

  const getActiveBlockRange = (): { from: number; to: number } | null => {
    if (!editor.value || !activeBlock.value) return null;
    const node = editor.value.state.doc.nodeAt(activeBlock.value.position);
    if (!node) return null;
    const from = activeBlock.value.position;
    return {
      from,
      to: node.type.name === "heading" ? findHeadingSectionEnd(from) : from + node.nodeSize,
    };
  };

  // 在当前内容块后创建普通空段落，光标直接落入新段落继续输入。
  const addBlockAfter = (): void => {
    if (!editor.value) return;
    const range = getActiveBlockRange();
    if (!range) return;
    const paragraph = editor.value.schema.nodes.paragraph.create();
    const transaction = editor.value.state.tr.insert(range.to, paragraph);
    transaction.setSelection(TextSelection.create(transaction.doc, range.to + 1));
    editor.value.view.dispatch(transaction.scrollIntoView());
    closeBlockMenu();
    editor.value.commands.focus();
  };

  const duplicateActiveBlock = (): void => {
    if (!editor.value) return;
    const range = getActiveBlockRange();
    if (!range) return;
    const content = editor.value.state.doc.slice(range.from, range.to).content;
    editor.value.view.dispatch(editor.value.state.tr.insert(range.to, content).scrollIntoView());
    closeBlockMenu();
  };

  const deleteActiveBlock = (): void => {
    if (!editor.value) return;
    const range = getActiveBlockRange();
    if (!range) return;
    editor.value.view.dispatch(editor.value.state.tr.delete(range.from, range.to).scrollIntoView());
    closeBlockMenu();
    blockControlVisible.value = false;
  };

  const moveActiveBlock = (direction: "up" | "down"): void => {
    if (!editor.value) return;
    const range = getActiveBlockRange();
    if (!range) return;
    const documentNode = editor.value.state.doc;
    let target = direction === "up" ? -1 : documentNode.content.size;
    documentNode.forEach((node, position) => {
      if (direction === "up" && position < range.from) target = position;
      if (direction === "down" && position >= range.to && target === documentNode.content.size) {
        target = position + node.nodeSize;
      }
    });
    if (target < 0 || (direction === "down" && target === documentNode.content.size)) return;
    const content = documentNode.slice(range.from, range.to).content;
    const transaction = editor.value.state.tr.delete(range.from, range.to);
    const insertAt = direction === "down" ? target - (range.to - range.from) : target;
    transaction.insert(insertAt, content);
    editor.value.view.dispatch(transaction.scrollIntoView());
    closeBlockMenu();
    blockControlVisible.value = false;
  };

  const copyActiveBlockText = async (): Promise<void> => {
    if (!editor.value || !activeBlock.value) return;
    const node = editor.value.state.doc.nodeAt(activeBlock.value.position);
    if (!node) return;
    await navigator.clipboard.writeText(node.textContent);
    closeBlockMenu();
  };

  const toggleActiveHeading = (): void => {
    if (!editor.value || !activeBlock.value?.isHeading) return;

    editor.value.view.dispatch(
      editor.value.state.tr.setMeta(sectionCollapseKey, {
        type: "toggle",
        position: activeBlock.value.position,
      }),
    );
    editorRenderVersion.value += 1;
    void nextTick(refreshBlockControlPosition);
  };

  const findHeadingSectionEnd = (headingPosition: number): number => {
    if (!editor.value) return headingPosition;

    const documentNode = editor.value.state.doc;
    const heading = documentNode.nodeAt(headingPosition);
    if (!heading || heading.type.name !== "heading") return headingPosition;

    const headingLevel = Number(heading.attrs.level);
    let sectionEnd = documentNode.content.size;
    let foundBoundary = false;
    documentNode.forEach((node, position) => {
      if (
        !foundBoundary &&
        position > headingPosition &&
        node.type.name === "heading" &&
        Number(node.attrs.level) <= headingLevel
      ) {
        sectionEnd = position;
        foundBoundary = true;
      }
    });

    return sectionEnd;
  };

  const handleBlockDragStart = (event: DragEvent): void => {
    if (!editor.value || !activeBlock.value || !event.dataTransfer) return;

    closeBlockMenu();
    draggedBlockPosition.value = activeBlock.value.position;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/x-xmd-block-position",
      String(activeBlock.value.position),
    );
    event.dataTransfer.setData(
      "text/plain",
      editor.value.state.doc.nodeAt(activeBlock.value.position)?.textContent ??
        "",
    );
  };

  const handleBlockDragOver = (event: DragEvent): void => {
    if (draggedBlockPosition.value === null) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

    const pointedElement = document.elementFromPoint(
      event.clientX,
      event.clientY,
    );
    const targetBlock = resolveTopLevelBlock(pointedElement);
    if (!targetBlock || !editor.value) return;

    const targetNode = editor.value.state.doc.nodeAt(targetBlock.position);
    if (!targetNode) return;

    const targetRect = targetBlock.element.getBoundingClientRect();
    const placeAfter = event.clientY > targetRect.top + targetRect.height / 2;
    dropIndicator.value = {
      position: placeAfter
        ? targetBlock.position + targetNode.nodeSize
        : targetBlock.position,
      left: targetRect.left,
      top: placeAfter ? targetRect.bottom : targetRect.top,
      width: targetRect.width,
    };
  };

  const finishBlockDrag = (): void => {
    draggedBlockPosition.value = null;
    dropIndicator.value = null;
    blockControlVisible.value = false;
  };

  const handleBlockDrop = (event: DragEvent): void => {
    if (
      !editor.value ||
      draggedBlockPosition.value === null ||
      !dropIndicator.value
    )
      return;

    event.preventDefault();
    event.stopPropagation();
    const sourceStart = draggedBlockPosition.value;
    const sourceNode = editor.value.state.doc.nodeAt(sourceStart);
    if (!sourceNode) {
      finishBlockDrag();
      return;
    }

    // 拖动标题时连同其下属章节一起移动，折叠与展开状态下的结果保持一致。
    const sourceEnd =
      sourceNode.type.name === "heading"
        ? findHeadingSectionEnd(sourceStart)
        : sourceStart + sourceNode.nodeSize;
    const requestedInsertPosition = dropIndicator.value.position;
    if (
      requestedInsertPosition >= sourceStart &&
      requestedInsertPosition <= sourceEnd
    ) {
      finishBlockDrag();
      return;
    }

    const movedContent = editor.value.state.doc.slice(
      sourceStart,
      sourceEnd,
    ).content;
    const insertPosition =
      requestedInsertPosition > sourceEnd
        ? requestedInsertPosition - (sourceEnd - sourceStart)
        : requestedInsertPosition;
    const transaction = editor.value.state.tr
      .delete(sourceStart, sourceEnd)
      .insert(insertPosition, movedContent);
    transaction.setSelection(
      NodeSelection.create(transaction.doc, insertPosition),
    );
    editor.value.view.dispatch(transaction.scrollIntoView());
    finishBlockDrag();
  };

  const handleEditorKeyDown = (
    view: EditorView,
    event: KeyboardEvent,
  ): boolean => {
    if (handleSlashMenuKeydown(event)) return true;
    if (handleEmojiMenuKeydown(event)) return true;
    if (event.isComposing) return false;
    if (handleCodeBlockSelectAll(view, event)) return true;
    if (handleCodeBlockTab(view, event)) return true;
    if (handleTableSelectAll(view, event)) return true;

    if (
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();

      // 表格中的 Tab 保留电子表格式导航，最后一个单元格由 TipTap 负责新增行。
      if (editor.value?.isActive("table")) {
        return event.shiftKey
          ? editor.value.commands.goToPreviousCell()
          : editor.value.commands.goToNextCell();
      }

      // 普通列表和任务列表使用相同的层级操作，无法继续缩进时也不让焦点逃出编辑器。
      const listItemType = editor.value?.isActive("taskItem")
        ? "taskItem"
        : editor.value?.isActive("listItem")
          ? "listItem"
          : null;
      if (listItemType) {
        if (event.shiftKey) editor.value?.commands.liftListItem(listItemType);
        else editor.value?.commands.sinkListItem(listItemType);
        return true;
      }

      const { selection } = view.state;

      // 普通段落和标题同样使用两个空格缩进，避免 Tab 被拦截后看起来没有响应。
      if (!event.shiftKey) {
        view.dispatch(
          view.state.tr.insertText("  ", selection.from, selection.to),
        );
        return true;
      }

      // Shift+Tab 只删除光标前紧邻的一到两个空格，不会误删用户输入的正文。
      if (!selection.empty) return true;
      const textBeforeCursor = selection.$from.parent.textBetween(
        0,
        selection.$from.parentOffset,
        undefined,
        "\ufffc",
      );
      const indentationLength = textBeforeCursor.match(/ {1,2}$/)?.[0].length ?? 0;
      if (indentationLength > 0) {
        view.dispatch(
          view.state.tr.delete(
            selection.from - indentationLength,
            selection.from,
          ),
        );
      }

      return true;
    }

    const { selection } = view.state;
    const { $from } = selection;
    if (!selection.empty || $from.parent.type.name !== "codeBlock")
      return false;

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      return editor.value?.chain().focus().exitCode().run() ?? false;
    }

    if (event.key !== "Enter") return false;

    const textBeforeCursor = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      "\ufffc",
    );
    const currentLine = textBeforeCursor.slice(
      textBeforeCursor.lastIndexOf("\n") + 1,
    );
    if (currentLine.trim() !== "```") return false;

    event.preventDefault();
    const fenceStart = selection.from - currentLine.length;
    return (
      editor.value
        ?.chain()
        .focus()
        .deleteRange({ from: fenceStart, to: selection.from })
        .exitCode()
        .run() ?? false
    );
  };

  // 编辑器实例
  const editor = useTiptapEditor({
    content: getContent(),
    // 扩展配置与导出渲染共用同一份定义，避免导出结果和编辑视图行为不一致。
    extensions: createEditorExtensions({ getCurrentDocumentPath }),
    editorProps: {
      attributes: {
        // 左右内边距与行宽由排版设置统一控制（typography-pane 上的 CSS 变量）。
        class:
          "prose-editor min-h-full pb-[200px] pt-4 [&>*:first-child]:mt-0",
        // Markdown 中包含大量技术名词和路径，关闭浏览器拼写检查可避免无意义的红色波浪线。
        spellcheck: "false",
      },
      handleKeyDown: (view, event) => handleEditorKeyDown(view, event),
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const { selection } = view.state;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const cellSelection = selection instanceof CellSelection;
        const tableSelection =
          selection instanceof NodeSelection && selection.node.type.name === "table";
        // 光标落在某个单元格时，粘贴默认会替换该格内容；这里改为追加到该格内容末尾。
        const cellTextEnd = getCellContentEndPosition(selection);

        if (files.length === 0 && text && cellTextEnd !== null) {
          event.preventDefault();
          editor.value?.chain().focus().insertContentAt(cellTextEnd, text).run();
          return true;
        }
        // 表格中一旦出现跨单元格选中（例如整表被选中），粘贴文本时先收敛到起始单元格
        // 再插入，避免默认行为把整行/整表的原内容整体替换掉。
        if (files.length === 0 && text && (cellSelection || tableSelection)) {
          event.preventDefault();
          const startPosition = cellSelection
            ? selection.$anchorCell.pos + 1
            : selection.from + selection.node.nodeSize;
          editor.value?.chain().focus().insertContentAt(startPosition, text).run();
          return true;
        }
        if (files.length === 0) return false;

        // Ctrl+V 可能来自资源管理器，也可能是截图，二者由统一入口分别读取路径或二进制。
        void insertExternalFiles(files, view.state.selection.from);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;

        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertExternalFiles(files, coordinates?.pos ?? view.state.selection.from);
        return true;
      },
      handleDOMEvents: {
        copy: (view, event) => {
          const { selection } = view.state;

          if (selection instanceof TextSelection && !selection.empty && event.clipboardData) {
            let sharedTableCellDepth: number | null = null;
            for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
              const nodeName = selection.$from.node(depth).type.name;
              if (
                (nodeName === "tableCell" || nodeName === "tableHeader") &&
                depth <= selection.$to.depth &&
                selection.$from.before(depth) === selection.$to.before(depth)
              ) {
                sharedTableCellDepth = depth;
                break;
              }
            }

            // 同一文本块内属于普通局部复制；同一单元格还需覆盖跨段落选择的情况。
            const isLocalTextSelection = selection.$from.parent === selection.$to.parent;
            if (isLocalTextSelection || sharedTableCellDepth !== null) {
              const selectedSlice = selection.content();
              const container = document.createElement("div");
              container.appendChild(
                DOMSerializer.fromSchema(view.state.schema).serializeFragment(selectedSlice.content),
              );

              /*
               * 局部文字只复制实际选中的内容，不让 Markdown 序列化器补上标题、列表、
               * 代码围栏或 table 标签。HTML 数据用于保留加粗等行内格式，纯文本用于普通粘贴。
               */
              event.preventDefault();
              event.clipboardData.setData(
                "text/plain",
                view.state.doc.textBetween(selection.from, selection.to, "\n"),
              );
              event.clipboardData.setData("text/html", container.innerHTML);
              return true;
            }
          }

          if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
            return false;
          }

          // 阻止默认节点序列化覆盖剪贴板，再由主进程写入可粘贴到其他软件的真实位图。
          event.preventDefault();
          void mediaService
            .copyImage(String(selection.node.attrs.src), getCurrentDocumentPath?.() ?? null)
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "未知错误";
              void window.electronAPI.showErrorMessage("复制图片失败", message);
            });
          return true;
        },
        blur: (view, event) => {
          // 焦点移到菜单内部时不要关闭，否则点击滚动条或菜单项会丢失菜单。
          const related = event.relatedTarget as Node | null;
          if (related && slashMenu.value?.contains(related)) return false;
          if (related && related instanceof HTMLElement && related.closest("[data-emoji-picker]")) return false;
          closeSlashMenu();
          closeEmojiMenu();
          return false;
        },
      },
    },
    onUpdate: ({ editor, transaction }) => {
      /*
       * 斜杠菜单和 Emoji 菜单属于编辑器界面状态，必须在每次正文变化后刷新。
       * 外部加载文档时虽然不能把 Markdown 回传给文档层，但仍要完成界面同步；
       * 否则首次输入“/”可能因为加载事务被过滤而看不到菜单，直到下一次事务才恢复。
       */
      refreshSlashMenu(editor);
      refreshEmojiMenu(editor);

      /*
       * 表格列宽、尾随段落等插件可能在文件刚打开且编辑器未获得焦点时调整内部文档。
       * 这些事务不代表用户编辑，不能向文档层发送更新，否则会触发自动保存覆盖原文件。
       */
      if (!shouldEmitMarkdownUpdate(transaction, editor.isFocused)) return;

      // 获取 Markdown 内容
      const markdown = editor.storage.markdown.getMarkdown();
      lastEmittedMarkdown = markdown;
      if (emit) {
        emit("update:content", markdown);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      refreshSlashMenu(editor);
      refreshEmojiMenu(editor);
      // 全选包含不可编辑的媒体节点，给编辑器根节点添加状态，统一显示整块选区。
      editor.view.dom.classList.toggle(
        "is-all-selected",
        editor.state.selection instanceof AllSelection,
      );
    },
    onTransaction: ({ transaction }) => {
      // 光标移动也会产生事务，但不会改变正文或折叠状态，无需刷新块控件相关视图。
      const collapseStateChanged = transaction.getMeta(sectionCollapseKey) !== undefined;
      if (transaction.docChanged || collapseStateChanged) {
        editorRenderVersion.value += 1;
        if (blockControlVisible.value) void nextTick(refreshBlockControlPosition);
      }
    },
  });

  // 富文本视图重新显示或切换标签时才同步内容，源码输入期间不解析隐藏的编辑器。
  watch(
    [getContent, getIsActive, () => getCurrentDocumentPath?.() ?? null],
    ([newContent, isActive, currentDocumentPath]) => {
      if (!editor.value || !isActive) return;

      // 相对资源地址必须以当前 Markdown 文件所在目录为基准。
      // 即使两个标签页正文完全相同，只要文件路径发生变化，也要重建媒体节点，
      // 防止图片、视频和附件继续使用上一个标签页的目录进行解析。
      const documentPathChanged = currentDocumentPath !== renderedDocumentPath;
      renderedDocumentPath = currentDocumentPath;

      // 编辑器刚发出的内容不需要再次序列化比较，避免每次输入重复扫描全文。
      if (!documentPathChanged && newContent === lastEmittedMarkdown) {
        lastEmittedMarkdown = null;
        return;
      }
      if (
        !documentPathChanged &&
        newContent === editor.value.storage.markdown.getMarkdown()
      ) return;

      // 外部载入文档或切换文件目录时不触发编辑事件，避免文档被误标记为已修改。
      editor.value.commands.setContent(newContent, false);
    },
  );

  const scrollToHeading = (headingIndex: number): void => {
    if (!editor.value) return;

    // 大纲和编辑器都按文档顺序读取标题，直接定位真实标题节点，避免依赖不存在的 data 属性。
    const headingElements = editor.value.view.dom.querySelectorAll<HTMLElement>(
      "h1, h2, h3, h4, h5, h6",
    );
    const targetHeading = headingElements.item(headingIndex);
    targetHeading?.scrollIntoView({ block: "start" });
  };

  // 生命周期
  onMounted(() => {
    window.addEventListener("resize", refreshBlockControlPosition);
  });

  onUnmounted(() => {
    window.removeEventListener("resize", refreshBlockControlPosition);
    editor.value?.destroy();
  });

  return {
    editor,
    slashMenuVisible,
    slashMenu,
    slashQuery,
    linkInsertVisible,
    linkInsertUrl,
    linkInsertLabel,
    linkInsertError,
    slashRange,
    selectedCommandIndex,
    slashMenuPosition,
    emojiMenuMode,
    emojiQuery,
    emojiSelectedIndex,
    filteredEmojis,
    emojiGridItems,
    emojiMenuStyle,
    insertEmoji,
    cancelEmojiMenu,
    activeBlock,
    blockControlVisible,
    blockMenuVisible,
    blockControlPosition,
    dropIndicator,
    draggedBlockPosition,
    editorRenderVersion,
    filteredCommands,
    commandGroups,
    slashMenuStyle,
    blockControlStyle,
    blockMenuStyle,
    dropIndicatorStyle,
    activeBlockCollapsed,
    activeBlockIsFirst,
    activeBlockIsLast,
    closeSlashMenu,
    refreshSlashMenu,
    handleSlashMenuScroll,
    executeSlashCommand,
    cancelLinkInsert,
    submitLinkInsert,
    handleSlashMenuKeydown,
    resolveTopLevelBlock,
    refreshBlockControlPosition,
    handleEditorMouseMove,
    handleEditorMouseLeave,
    handleBlockControlLeave,
    toggleBlockMenu,
    closeBlockMenu,
    addBlockAfter,
    duplicateActiveBlock,
    deleteActiveBlock,
    moveActiveBlock,
    copyActiveBlockText,
    toggleActiveHeading,
    findHeadingSectionEnd,
    handleBlockDragStart,
    handleBlockDragOver,
    finishBlockDrag,
    handleBlockDrop,
    handleEditorKeyDown,
    scrollToHeading,
  };
};
