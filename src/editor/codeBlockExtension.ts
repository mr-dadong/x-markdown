import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import graphql from "highlight.js/lib/languages/graphql";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import vbnet from "highlight.js/lib/languages/vbnet";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import CodeBlockView from "../components/CodeBlockView.vue";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { serializeFencedCodeBlock } from "./markdownSerialization";

// 只注册编辑器实际支持的语言，避免把整套语言包打入安装文件。
export const editorLowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  graphql,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  markdown,
  objectivec,
  perl,
  php,
  plaintext,
  python,
  r,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  vbnet,
  xml,
  yaml,
});

// Shell 与 Bash 共用语法规则，但在界面中仍可保留两个名称。
editorLowlight.registerAlias("bash", ["shell"]);

// 代码块的解析能力与 Vue 节点界面在此统一装配。
export const InteractiveCodeBlock = CodeBlockLowlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const content = node.textContent;
          const language = String(node.attrs.language ?? "");

          state.write(serializeFencedCodeBlock(content, language));
          state.closeBlock(node);
        },
        parse: {
          setup(
            this: { options: { languageClassPrefix?: string } },
            markdown: { set: (options: { langPrefix: string }) => void },
          ) {
            markdown.set({
              langPrefix: this.options.languageClassPrefix ?? "language-",
            });
          },
          updateDOM(element: HTMLElement) {
            /*
             * markdown-it 会在代码内容末尾附加一个用于连接关闭围栏的结构性换行。
             * 这里只删除这一个换行，用户实际输入的尾随空行仍会保留。
             */
            element.querySelectorAll("pre > code").forEach((codeElement) => {
              const lastChild = codeElement.lastChild;
              if (lastChild?.nodeType !== Node.TEXT_NODE) return;
              lastChild.textContent = lastChild.textContent?.replace(/\n$/u, "") ?? "";
            });
          },
        },
      },
    };
  },
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView);
  },
});
