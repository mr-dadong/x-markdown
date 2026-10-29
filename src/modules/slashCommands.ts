import type { MessageKey } from "../i18n/messages/zh-CN";
import { t } from "../composables/useI18n";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useSettings } from "../composables/useSettings";
import { mediaService } from "../services/mediaService";
import { createAttachmentTransferTracker } from "./attachmentTransferTracker";

export interface SlashRange {
  from: number;
  to: number;
}

export type SlashCommandGroup = "basic" | "list" | "media" | "callout" | "extended";

export interface SlashCommand {
  id: string;
  group: SlashCommandGroup;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: string;
  iconClass: string;
  keywords: string[];
  opensLinkForm?: boolean;
  opensEmojiPicker?: boolean;
  opensAiWriter?: boolean;
  run?: (
    editor: Editor,
    range: SlashRange,
    currentDocumentPath: string | null,
  ) => boolean | void | Promise<void>;
}

// 组序固定：提示块紧跟媒体与链接，扩展内容始终是最后一个组，
// 便于后续接入外部扩展时保持“扩展组垫底”的稳定预期。
export const slashCommandGroups: SlashCommandGroup[] = [
  "basic",
  "list",
  "media",
  "callout",
  "extended",
];

// 分组 id 保持稳定，显示文案随界面语言切换。
export const slashCommandGroupKeys: Record<SlashCommandGroup, MessageKey> = {
  basic: "slash.group.basic",
  list: "slash.group.list",
  media: "slash.group.media",
  callout: "slash.group.callout",
  extended: "slash.group.extended",
};

const insertMarkdownModule = (
  editor: Editor,
  range: SlashRange,
  type: string,
  attrs?: Record<string, unknown>,
): boolean =>
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([{ type, attrs }, { type: "paragraph" }])
    .run();

const getNextFootnoteIdentifier = (editor: Editor): string => {
  const identifiers = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnoteReference" || node.type.name === "footnoteDefinition") {
      identifiers.add(String(node.attrs.identifier));
    }
  });

  let nextIdentifier = 1;
  while (identifiers.has(String(nextIdentifier))) nextIdentifier += 1;
  return String(nextIdentifier);
};

// 每个命令显式维护中文、英文、全拼和拼音首字母，避免自动转换带来的多音字误判。
export const slashCommands: SlashCommand[] = [
  {
    id: "paragraph",
    group: "basic",
    labelKey: "slash.paragraph.label",
    descriptionKey: "slash.paragraph.description",
    icon: "lucide:pilcrow",
    iconClass: "bg-selected text-accent",
    keywords: ["文本", "段落", "正文", "text", "paragraph", "wenben", "wb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading-1",
    group: "basic",
    labelKey: "slash.heading1.label",
    descriptionKey: "slash.heading1.description",
    icon: "lucide:heading-1",
    iconClass: "bg-toolbar text-accent",
    keywords: ["一级标题", "标题1", "h1", "heading1", "yijibiaoti", "yjbt"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    group: "basic",
    labelKey: "slash.heading2.label",
    descriptionKey: "slash.heading2.description",
    icon: "lucide:heading-2",
    iconClass: "bg-toolbar text-accent",
    keywords: ["二级标题", "标题2", "h2", "heading2", "erjibiaoti", "ejbt"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    group: "basic",
    labelKey: "slash.heading3.label",
    descriptionKey: "slash.heading3.description",
    icon: "lucide:heading-3",
    iconClass: "bg-toolbar text-accent",
    keywords: ["三级标题", "标题3", "h3", "heading3", "sanjibiaoti", "sjbt"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "emoji",
    group: "basic",
    labelKey: "slash.emoji.label",
    descriptionKey: "slash.emoji.description",
    icon: "lucide:smile-plus",
    iconClass: "bg-selected text-accent",
    keywords: ["表情", "emoji", "符号", "笑脸", "biaoqing", "bq"],
    opensEmojiPicker: true,
  },
  {
    id: "bullet-list",
    group: "list",
    labelKey: "slash.bulletList.label",
    descriptionKey: "slash.bulletList.description",
    icon: "lucide:list",
    iconClass: "bg-toolbar text-secondary",
    keywords: ["无序列表", "项目符号", "列表", "bullet", "unordered", "ul", "wuxuliebiao", "wxlb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    group: "list",
    labelKey: "slash.orderedList.label",
    descriptionKey: "slash.orderedList.description",
    icon: "lucide:list-ordered",
    iconClass: "bg-toolbar text-secondary",
    keywords: ["有序列表", "编号", "数字列表", "ordered", "list", "ol", "youxuliebiao", "yxlb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "task-list",
    group: "list",
    labelKey: "slash.taskList.label",
    descriptionKey: "slash.taskList.description",
    icon: "lucide:list-checks",
    iconClass: "bg-toolbar text-secondary",
    keywords: ["任务列表", "待办", "清单", "todo", "task", "checklist", "renwuliebiao", "rwlb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "blockquote",
    group: "list",
    labelKey: "slash.blockquote.label",
    descriptionKey: "slash.blockquote.description",
    icon: "lucide:quote",
    iconClass: "bg-toolbar text-folder",
    keywords: ["引用", "引言", "quote", "blockquote", "yinyong", "yy"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: "code-block",
    group: "list",
    labelKey: "slash.codeBlock.label",
    descriptionKey: "slash.codeBlock.description",
    icon: "lucide:code-2",
    iconClass: "bg-toolbar text-danger",
    keywords: ["代码块", "代码", "code", "codeblock", "daimakuai", "dmk"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: "horizontal-rule",
    group: "list",
    labelKey: "slash.horizontalRule.label",
    descriptionKey: "slash.horizontalRule.description",
    icon: "lucide:minus",
    iconClass: "bg-toolbar text-muted",
    keywords: ["分割线", "水平线", "divider", "rule", "hr", "fengexian", "fgx"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "page-break",
    group: "list",
    labelKey: "slash.pageBreak.label",
    descriptionKey: "slash.pageBreak.description",
    icon: "lucide:separator-horizontal",
    iconClass: "bg-toolbar text-muted",
    keywords: ["分页", "分页符", "换页", "pagebreak", "page-break", "fenye", "fenyefu", "fyf"],
    // 分页符是原子块节点，插入后补一个空段落，光标才能继续往下写正文。
    run: (editor, range) => insertMarkdownModule(editor, range, "pageBreak"),
  },
  {
    id: "table",
    group: "list",
    labelKey: "slash.table.label",
    descriptionKey: "slash.table.description",
    icon: "lucide:table-2",
    iconClass: "bg-selected text-accent-strong",
    keywords: ["表格", "table", "grid", "biaoge", "bg"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "table-of-contents",
    group: "extended",
    labelKey: "slash.toc.label",
    descriptionKey: "slash.toc.description",
    icon: "lucide:list-tree",
    iconClass: "bg-selected text-accent",
    keywords: ["目录", "大纲", "toc", "contents", "mulu", "ml"],
    run: (editor, range) => insertMarkdownModule(editor, range, "tableOfContents"),
  },
  {
    id: "mermaid",
    group: "extended",
    labelKey: "slash.mermaid.label",
    descriptionKey: "slash.mermaid.description",
    icon: "lucide:braces",
    iconClass: "bg-toolbar text-link",
    keywords: ["流程图", "图表", "mermaid", "diagram", "liuchengtu", "lct"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "mermaidBlock", {
        source: "graph TD\n  A[开始] --> B[结束]",
      }),
  },
  {
    id: "math-block",
    group: "extended",
    labelKey: "slash.mathBlock.label",
    descriptionKey: "slash.mathBlock.description",
    icon: "lucide:code-2",
    iconClass: "bg-toolbar text-accent",
    keywords: ["公式", "数学", "katex", "latex", "math", "gongshi", "gs"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "mathBlock", { expression: "E = mc^2" }),
  },
  // 提示块拆成 5 种类型命令：类型在插入时定死，编辑弹层只改正文。
  {
    id: "callout-note",
    group: "callout",
    labelKey: "slash.calloutNote.label",
    descriptionKey: "slash.calloutNote.description",
    icon: "lucide:info",
    iconClass: "bg-toolbar text-secondary",
    keywords: ["备注", "callout", "admonition", "beizhu", "bz"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "callout", {
        calloutType: "NOTE",
        title: "",
        fold: "",
        body: "在这里输入提示内容。",
      }),
  },
  {
    id: "callout",
    group: "callout",
    labelKey: "slash.calloutTip.label",
    descriptionKey: "slash.calloutTip.description",
    icon: "lucide:check",
    iconClass: "bg-toolbar text-link",
    keywords: ["提示块", "警告", "callout", "admonition", "tishikuai", "tsk"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "callout", {
        calloutType: "TIP",
        title: "",
        fold: "",
        body: "在这里输入提示内容。",
      }),
  },
  {
    id: "callout-important",
    group: "callout",
    labelKey: "slash.calloutImportant.label",
    descriptionKey: "slash.calloutImportant.description",
    icon: "lucide:alert-triangle",
    iconClass: "bg-toolbar text-folder",
    keywords: ["重要", "callout", "admonition", "zhongyao", "zy"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "callout", {
        calloutType: "IMPORTANT",
        title: "",
        fold: "",
        body: "在这里输入提示内容。",
      }),
  },
  {
    id: "callout-warning",
    group: "callout",
    labelKey: "slash.calloutWarning.label",
    descriptionKey: "slash.calloutWarning.description",
    icon: "lucide:file-warning",
    iconClass: "bg-toolbar text-folder",
    keywords: ["警告", "callout", "admonition", "jinggao", "jg"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "callout", {
        calloutType: "WARNING",
        title: "",
        fold: "",
        body: "在这里输入提示内容。",
      }),
  },
  {
    id: "callout-caution",
    group: "callout",
    labelKey: "slash.calloutCaution.label",
    descriptionKey: "slash.calloutCaution.description",
    icon: "lucide:alert-triangle",
    iconClass: "bg-toolbar text-danger",
    keywords: ["注意", "callout", "admonition", "zhuyi", "zyi"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "callout", {
        calloutType: "CAUTION",
        title: "",
        fold: "",
        body: "在这里输入提示内容。",
      }),
  },
  {
    id: "footnote",
    group: "extended",
    labelKey: "slash.footnote.label",
    descriptionKey: "slash.footnote.description",
    icon: "lucide:file-text",
    iconClass: "bg-toolbar text-folder",
    keywords: ["脚注", "注释", "footnote", "reference", "jiaozhu", "jz"],
    run: (editor, range) => {
      const identifier = getNextFootnoteIdentifier(editor);
      const referenceInserted = editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "footnoteReference", attrs: { identifier } })
        .run();
      if (!referenceInserted) return false;

      // 定义统一追加到文档末尾，引用处保持当前写作光标。
      return editor.commands.insertContentAt(editor.state.doc.content.size, [
        { type: "footnoteDefinition", attrs: { identifier, body: "脚注内容" } },
        { type: "paragraph" },
      ]);
    },
  },
  {
    id: "image",
    group: "media",
    labelKey: "slash.image.label",
    descriptionKey: "slash.image.description",
    icon: "lucide:image",
    iconClass: "bg-selected text-accent",
    keywords: ["图片", "照片", "图像", "image", "photo", "charutupian", "crtp"],
    run: async (editor, range, currentDocumentPath) => {
      const selected = await mediaService.selectFile({ kind: "image", currentDocumentPath });
      if (!selected) return;
      editor.chain().focus().deleteRange(range).setImage({ src: selected.url, alt: selected.fileName }).run();
    },
  },
  {
    id: "attachment",
    group: "media",
    labelKey: "slash.attachment.label",
    descriptionKey: "slash.attachment.description",
    icon: "lucide:paperclip",
    iconClass: "bg-toolbar text-folder",
    keywords: ["附件", "文件", "压缩包", "attachment", "file", "charuwenjian", "crwj"],
    run: async (editor, range, currentDocumentPath) => {
      const { settings } = useSettings();
      const requestId = crypto.randomUUID();
      let transferInserted = false;
      // 进度卡片的查找/刷新/替换统一由 tracker 负责，这里只决定插入位置。
      const tracker = createAttachmentTransferTracker(editor, requestId);

      const removeProgressListener = mediaService.onAttachmentCopyProgress((progress) => {
        if (progress.requestId !== requestId) return;

        if (!transferInserted) {
          transferInserted = true;
          // 首次事件到达时用当前 range 起点落卡片，并顺带删掉斜杠命令源码。
          editor.chain().focus().deleteRange(range).run();
          tracker.insert(range.from, progress);
          return;
        }

        tracker.update(progress);
      });

      let selected: Awaited<ReturnType<typeof mediaService.selectFile>> = null;
      try {
        selected = await mediaService.selectFile({
          kind: "file",
          currentDocumentPath,
          attachmentHandling: settings.attachmentHandling,
          requestId,
        });
      } catch (error) {
        // 失败状态已由主进程进度事件写入卡片，这里只记录诊断信息。
        console.error("复制附件失败:", error);
      } finally {
        removeProgressListener();
      }
      if (!selected) return;

      if (tracker.replaceWithAttachment(selected)) return;

      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: "attachment",
            attrs: {
              fileName: selected.fileName,
              fileSize: selected.fileSize,
              fileType: selected.fileType,
              url: selected.url,
            },
          },
          { type: "paragraph" },
        ])
        // 块节点后强制寻找文字选区，避免显示为横向的 Gap Cursor。
        .command(({ tr }) => {
          const textSelection = TextSelection.findFrom(tr.selection.$to, 1, true);
          if (textSelection) tr.setSelection(textSelection);
          return true;
        })
        .run();
    },
  },
  {
    id: "video",
    group: "media",
    labelKey: "slash.video.label",
    descriptionKey: "slash.video.description",
    icon: "lucide:video",
    iconClass: "bg-toolbar text-danger",
    keywords: ["视频", "影片", "video", "movie", "mp4", "charushipin", "crsp"],
    run: async (editor, range, currentDocumentPath) => {
      const selected = await mediaService.selectFile({ kind: "video", currentDocumentPath });
      if (!selected) return;
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          { type: "video", attrs: { src: selected.url } },
          { type: "paragraph" },
        ])
        // 视频后保留文字光标，插入完成后可继续输入正文。
        .command(({ tr }) => {
          const textSelection = TextSelection.findFrom(tr.selection.$to, 1, true);
          if (textSelection) tr.setSelection(textSelection);
          return true;
        })
        .run();
    },
  },
  {
    id: "link",
    group: "media",
    labelKey: "slash.link.label",
    descriptionKey: "slash.link.description",
    icon: "lucide:link-2",
    iconClass: "bg-toolbar text-accent",
    keywords: ["超链接", "链接", "网址", "link", "url", "href", "charuchaolianjie", "crclj"],
    opensLinkForm: true,
  },
  {
    id: "ai-write",
    group: "extended",
    labelKey: "slash.aiWrite.label",
    descriptionKey: "slash.aiWrite.description",
    icon: "lucide:sparkles",
    iconClass: "bg-selected text-accent",
    keywords: ["AI", "实时编写", "生成", "写作", "续写", "shishi", "ssbx"],
    opensAiWriter: true,
  },
];

export const filterSlashCommands = (query: string): SlashCommand[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return slashCommands;

  return slashCommands
    .map((command, index) => {
      const searchableTexts = [
        t(command.labelKey),
        t(command.descriptionKey),
        ...command.keywords,
      ]
        .map((text) => text.toLocaleLowerCase());
      const exactMatch = searchableTexts.some((text) => text === normalizedQuery);
      const prefixMatch = searchableTexts.some((text) => text.startsWith(normalizedQuery));
      const partialMatch = searchableTexts.some((text) => text.includes(normalizedQuery));
      // 完整关键词最能表达用户意图，例如 /ai 应优先命中关键词正好为 AI 的实时编写。
      const score = exactMatch ? 0 : prefixMatch ? 1 : partialMatch ? 2 : 3;
      return { command, index, score };
    })
    .filter(({ score }) => score < 3)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ command }) => command);
};
