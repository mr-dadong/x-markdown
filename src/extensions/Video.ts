import { Extension, mergeAttributes, Node, type MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import VideoView from "../components/VideoView.vue";
import { neverInterruptParagraph, takeBlockRaw } from "./markdown/shared/officialMarkdown";

// TipTap v3 会把扩展的 Options 泛型带进 Node 的公开类型，createEditorExtensions
// 的导出类型因此需要能具名引用它，必须显式导出。
export interface VideoOptions {
  getCurrentDocumentPath: () => string | null;
}

const VIDEO_MARKDOWN_TITLE = "xmd-video";

const escapeMarkdownLabel = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");

const escapeMarkdownDestination = (value: string): string =>
  value
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll("\n", "%0A")
    .replaceAll("\r", "%0D");

const getVideoFileName = (source: string): string => {
  const pathWithoutQuery = source.split(/[?#]/, 1)[0];
  const lastSegment = pathWithoutQuery.split(/[\\/]/).pop();
  if (!lastSegment) return "视频";

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
};

// Markdown 没有原生视频语法，文件中保存普通链接，XMD 打开时再增强为播放器。
export const Video = Node.create<VideoOptions>({
  name: "video",
  group: "block",
  atom: true,

  addOptions() {
    return {
      getCurrentDocumentPath: () => null,
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [{ tag: "video[data-xmd-compatible-video][src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(HTMLAttributes, {
        controls: "true",
        "data-xmd-compatible-video": "",
        class: "my-6 max-h-[480px] w-full rounded-lg bg-[#1f2023]",
      }),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(VideoView);
  },

  // 普通 Markdown 阅读器至少会提供可点击链接，XMD 中的播放器样式保持不变。
  renderMarkdown: (node) => {
    const source = String(node.attrs?.src ?? "");
    const label = escapeMarkdownLabel(`播放视频：${getVideoFileName(source)}`);
    const destination = escapeMarkdownDestination(source);
    return `[${label}](<${destination}> "${VIDEO_MARKDOWN_TITLE}")`;
  },
});

/**
 * 把带 xmd-video 标题的链接还原为视频节点。
 *
 * 旧实现靠 markdown-it 的 updateDOM 钩子把 <a title="xmd-video"> 换成 <video>；
 * 官方管线没有 DOM 钩子。这里与附件增强器同样使用独立的块级 token，
 * 避免占用 paragraph token 名把官方 Paragraph 的 renderMarkdown 挤掉。
 */
const VIDEO_LINK_TOKEN = "xmdVideoLink";

/** 独占一行的视频链接：[文字](<地址> "xmd-video")。 */
const VIDEO_LINK_PATTERN = /^\[([^\]]*)\]\((?:<([^>]*)>|([^)\s]*))\s+"xmd-video"\)\s*$/u;

/** 解析「整行只有一个视频链接」的段落。 */
const tokenizeVideoLink = (src: string): MarkdownToken | undefined => {
  const lines = src.split("\n");
  const match = lines[0]?.match(VIDEO_LINK_PATTERN);
  if (!match) return undefined;
  // 下一行还有内容说明它们同属一个段落，此时不能替换成块级节点。
  if (lines.length > 1 && lines[1].trim() !== "") return undefined;

  return {
    type: VIDEO_LINK_TOKEN,
    raw: takeBlockRaw(lines, 1),
    href: (match[2] ?? match[3] ?? "").trim(),
  } as MarkdownToken;
};

export const VideoLinkParser = Extension.create({
  name: "videoLinkParser",

  markdownTokenName: VIDEO_LINK_TOKEN,

  parseMarkdown: (token) => ({
    type: "video",
    // 与附件一致：非 ASCII 路径按百分号编码后保存。
    attrs: { src: encodeURI(String(token.href ?? "")) },
  }),

  markdownTokenizer: {
    name: VIDEO_LINK_TOKEN,
    level: "block",
    start: neverInterruptParagraph,
    tokenize: (src: string) => tokenizeVideoLink(src),
  },
});
