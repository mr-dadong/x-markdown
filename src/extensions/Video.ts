import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import VideoView from "../components/VideoView.vue";

interface VideoOptions {
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

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const source = String(node.attrs.src);
          const label = escapeMarkdownLabel(`播放视频：${getVideoFileName(source)}`);
          const destination = escapeMarkdownDestination(source);

          // 普通 Markdown 阅读器至少会提供可点击链接，XMD 中的播放器样式保持不变。
          state.write(`[${label}](<${destination}> "${VIDEO_MARKDOWN_TITLE}")`);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element
              .querySelectorAll<HTMLAnchorElement>(`a[title="${VIDEO_MARKDOWN_TITLE}"]`)
              .forEach((link) => {
                const video = document.createElement("video");
                video.controls = true;
                video.dataset.xmdCompatibleVideo = "";
                video.setAttribute("src", link.getAttribute("href") ?? "");
                link.replaceWith(video);
              });
          },
        },
      },
    };
  },
});
