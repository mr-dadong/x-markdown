import { createLowlight } from "lowlight";
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import arduino from "highlight.js/lib/languages/arduino";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
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
import wasm from "highlight.js/lib/languages/wasm";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/*
 * 编辑器代码块与 AI 对话代码块共用同一份语言注册表，
 * 保证两处高亮行为一致，也避免把整套语言包打入安装文件。
 * 这里的键必须覆盖 codeBlockLanguages 里可选的每一种语言，
 * 否则用户选得到却没有高亮；一致性由 codeBlockLanguages.test.ts 守着。
 */
const languages: Record<string, LanguageFn> = {
  arduino,
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
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
  wasm,
  xml,
  yaml,
};

// 编辑器侧：TipTap 的 CodeBlockLowlight 扩展使用 lowlight 实例
export const editorLowlight = createLowlight(languages);

// AI 对话侧：highlight.js 核心实例直接输出高亮 HTML，与 lowlight 共用语法
for (const [name, grammar] of Object.entries(languages)) {
  hljs.registerLanguage(name, grammar);
}

// Shell 与 Bash 共用语法规则，但在界面中仍可保留两个名称。
// 两个实例都要注册别名，否则 ```shell 会出现「编辑器能高亮、AI 对话里降级成纯文本」的不一致。
editorLowlight.registerAlias("bash", ["shell"]);
hljs.registerAliases(["shell"], { languageName: "bash" });

/** 转义 HTML 特殊字符，未知语言的代码按纯文本安全输出 */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 判断 AI 对话侧是否认识某种语言。
 * 供语言清单一致性检查使用，避免选择器提供没有语法包的语言。
 */
export const isLanguageHighlightable = (lang: string): boolean =>
  Boolean(lang) && Boolean(hljs.getLanguage(lang));

/**
 * 将代码片段高亮为 HTML（含 hljs-* 类名，由代码块主题上色）。
 * 语言未注册或未标注时按纯文本转义输出，与编辑器默认语言行为一致。
 */
export const highlightCode = (lang: string, code: string): string => {
  if (lang && hljs.getLanguage(lang)) {
    // 使用非弃用的选项对象形式；ignoreIllegals 允许 AI 输出的不完整代码正常高亮
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
};
