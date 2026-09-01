import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useSettings } from "../composables/useSettings";
import { mediaService } from "../services/mediaService";

export interface SlashRange {
  from: number;
  to: number;
}

export interface SlashCommand {
  id: string;
  group: "基础" | "列表与内容" | "扩展内容" | "媒体与链接";
  label: string;
  description: string;
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

export const slashCommandGroups: SlashCommand["group"][] = [
  "基础",
  "列表与内容",
  "扩展内容",
  "媒体与链接",
];

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
    group: "基础",
    label: "文本",
    description: "切换为普通段落",
    icon: "lucide:pilcrow",
    iconClass: "bg-selected text-accent",
    keywords: ["文本", "段落", "正文", "text", "paragraph", "wenben", "wb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading-1",
    group: "基础",
    label: "一级标题",
    description: "插入 Markdown 一级标题",
    icon: "lucide:heading-1",
    iconClass: "bg-toolbar text-accent",
    keywords: ["一级标题", "标题1", "h1", "heading1", "yijibiaoti", "yjbt"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    group: "基础",
    label: "二级标题",
    description: "插入 Markdown 二级标题",
    icon: "lucide:heading-2",
    iconClass: "bg-toolbar text-accent",
    keywords: ["二级标题", "标题2", "h2", "heading2", "erjibiaoti", "ejbt"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    group: "基础",
    label: "三级标题",
    description: "插入 Markdown 三级标题",
    icon: "lucide:heading-3",
    iconClass: "bg-toolbar text-accent",
    keywords: ["三级标题", "标题3", "h3", "heading3", "sanjibiaoti", "sjbt"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "emoji",
    group: "基础",
    label: "插入 Emoji",
    description: "打开表情选择器",
    icon: "lucide:smile-plus",
    iconClass: "bg-selected text-accent",
    keywords: ["表情", "emoji", "符号", "笑脸", "biaoqing", "bq"],
    opensEmojiPicker: true,
  },
  {
    id: "bullet-list",
    group: "列表与内容",
    label: "无序列表",
    description: "创建项目符号列表",
    icon: "lucide:list",
    iconClass: "bg-toolbar text-secondary",
    keywords: ["无序列表", "项目符号", "列表", "bullet", "unordered", "ul", "wuxuliebiao", "wxlb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    group: "列表与内容",
    label: "有序列表",
    description: "创建数字编号列表",
    icon: "lucide:list-ordered",
    iconClass: "bg-toolbar text-secondary",
    keywords: ["有序列表", "编号", "数字列表", "ordered", "list", "ol", "youxuliebiao", "yxlb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "task-list",
    group: "列表与内容",
    label: "任务列表",
    description: "创建可勾选的待办事项",
    icon: "lucide:list-checks",
    iconClass: "bg-toolbar text-secondary",
    keywords: ["任务列表", "待办", "清单", "todo", "task", "checklist", "renwuliebiao", "rwlb"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "blockquote",
    group: "列表与内容",
    label: "引用",
    description: "创建 Markdown 引用块",
    icon: "lucide:quote",
    iconClass: "bg-toolbar text-folder",
    keywords: ["引用", "引言", "quote", "blockquote", "yinyong", "yy"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: "code-block",
    group: "列表与内容",
    label: "代码块",
    description: "插入带语法高亮的代码块",
    icon: "lucide:code-2",
    iconClass: "bg-toolbar text-danger",
    keywords: ["代码块", "代码", "code", "codeblock", "daimakuai", "dmk"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: "horizontal-rule",
    group: "列表与内容",
    label: "分割线",
    description: "插入一条 Markdown 分割线",
    icon: "lucide:minus",
    iconClass: "bg-toolbar text-muted",
    keywords: ["分割线", "水平线", "divider", "rule", "hr", "fengexian", "fgx"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "table",
    group: "列表与内容",
    label: "表格",
    description: "插入 3 × 3 表格",
    icon: "lucide:table-2",
    iconClass: "bg-selected text-accent-strong",
    keywords: ["表格", "table", "grid", "biaoge", "bg"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "table-of-contents",
    group: "扩展内容",
    label: "文档目录",
    description: "根据标题自动生成目录",
    icon: "lucide:list-tree",
    iconClass: "bg-selected text-accent",
    keywords: ["目录", "大纲", "toc", "contents", "mulu", "ml"],
    run: (editor, range) => insertMarkdownModule(editor, range, "tableOfContents"),
  },
  {
    id: "mermaid",
    group: "扩展内容",
    label: "Mermaid 图表",
    description: "插入可编辑的流程图",
    icon: "lucide:braces",
    iconClass: "bg-toolbar text-link",
    keywords: ["流程图", "图表", "mermaid", "diagram", "liuchengtu", "lct"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "mermaidBlock", {
        source: "graph TD\n  A[开始] --> B[结束]",
      }),
  },
  {
    id: "html-block",
    group: "扩展内容",
    label: "HTML 源码块",
    description: "插入原样保存的 HTML 块",
    icon: "lucide:file-code-2",
    iconClass: "bg-toolbar text-danger",
    keywords: ["HTML", "源码块", "标签", "html", "source", "tag", "yuanmakuai", "ymk"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "htmlBlock", {
        source: "<div>HTML 内容</div>",
      }),
  },
  {
    id: "math-block",
    group: "扩展内容",
    label: "数学公式",
    description: "插入 KaTeX 块级公式",
    icon: "lucide:code-2",
    iconClass: "bg-toolbar text-accent",
    keywords: ["公式", "数学", "katex", "latex", "math", "gongshi", "gs"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "mathBlock", { expression: "E = mc^2" }),
  },
  {
    id: "callout",
    group: "扩展内容",
    label: "提示块",
    description: "插入 Callout 提示内容",
    icon: "lucide:info",
    iconClass: "bg-toolbar text-link",
    keywords: ["提示块", "警告", "callout", "admonition", "tishikuai", "tsk"],
    run: (editor, range) =>
      insertMarkdownModule(editor, range, "callout", {
        calloutType: "NOTE",
        title: "提示",
        fold: "",
        body: "在这里输入提示内容。",
      }),
  },
  {
    id: "footnote",
    group: "扩展内容",
    label: "脚注",
    description: "插入脚注引用和定义",
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
    group: "媒体与链接",
    label: "插入图片",
    description: "选择本地图片",
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
    group: "媒体与链接",
    label: "插入文件",
    description: "插入可打开的本地文件卡片",
    icon: "lucide:paperclip",
    iconClass: "bg-toolbar text-folder",
    keywords: ["附件", "文件", "压缩包", "attachment", "file", "charuwenjian", "crwj"],
    run: async (editor, range, currentDocumentPath) => {
      const { settings } = useSettings();
      const requestId = crypto.randomUUID();
      let transferInserted = false;

      // 通过请求编号只接收本次复制事件，避免同时插入多个附件时相互覆盖进度。
      const findTransferPosition = (): number | null => {
        let position: number | null = null;
        editor.state.doc.descendants((node, nodePosition) => {
          if (node.type.name === "attachmentTransfer" && node.attrs.requestId === requestId) {
            position = nodePosition;
            return false;
          }
          return position === null;
        });
        return position;
      };

      const removeProgressListener = mediaService.onAttachmentCopyProgress((progress) => {
        if (progress.requestId !== requestId) return;

        if (!transferInserted) {
          transferInserted = true;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
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
            ])
            .run();
          return;
        }

        const position = findTransferPosition();
        if (position === null) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(position, undefined, {
            ...editor.state.doc.nodeAt(position)?.attrs,
            copiedBytes: progress.copiedBytes,
            totalBytes: progress.totalBytes,
            bytesPerSecond: progress.bytesPerSecond,
            status: progress.status,
            error: progress.error ?? "",
          }),
        );
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

      const transferPosition = findTransferPosition();
      if (transferPosition !== null) {
        const transferNode = editor.state.doc.nodeAt(transferPosition);
        if (transferNode) {
          editor.view.dispatch(
            editor.state.tr.replaceWith(
              transferPosition,
              transferPosition + transferNode.nodeSize,
              editor.schema.nodes.attachment.create({
                fileName: selected.fileName,
                fileSize: selected.fileSize,
                fileType: selected.fileType,
                url: selected.url,
              }),
            ),
          );
          return;
        }
      }

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
    group: "媒体与链接",
    label: "插入视频",
    description: "选择本地视频",
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
    group: "媒体与链接",
    label: "插入超链接",
    description: "添加文字与网址",
    icon: "lucide:link-2",
    iconClass: "bg-toolbar text-accent",
    keywords: ["超链接", "链接", "网址", "link", "url", "href", "charuchaolianjie", "crclj"],
    opensLinkForm: true,
  },
  {
    id: "ai-write",
    group: "扩展内容",
    label: "AI 实时编写",
    description: "让 AI 在光标处实时生成内容",
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
      const searchableTexts = [command.label, command.description, ...command.keywords]
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
