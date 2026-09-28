import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

let browserWindow: Window;
let buildCodeBlockSliceRoots: typeof import("./codeBlockImage").buildCodeBlockSliceRoots;
let resolveLinesPerSlice: typeof import("./codeBlockImage").resolveLinesPerSlice;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ buildCodeBlockSliceRoots, resolveLinesPerSlice } = await import("./codeBlockImage"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

/*
 * 模拟编辑器里已渲染的代码块 DOM：
 * 窗口式标题栏 + pre（行号列 + 带语法高亮的 code）。
 */
const createCodeBlockDom = (codeHtml: string, lineCount: number): HTMLElement => {
  const root = document.createElement("div");
  root.className = "code-block-editor";
  const header = document.createElement("div");
  header.setAttribute("data-xmd-code-header", "");
  header.innerHTML = '<button type="button">复制</button>';
  const pre = document.createElement("pre");
  pre.className = "whitespace-pre overflow-x-auto";

  const numberColumn = document.createElement("span");
  numberColumn.setAttribute("contenteditable", "false");
  for (let index = 1; index <= lineCount; index += 1) {
    const number = document.createElement("span");
    number.textContent = String(index);
    numberColumn.appendChild(number);
  }

  const code = document.createElement("code");
  code.className = "language-ts";
  code.innerHTML = codeHtml;

  pre.appendChild(numberColumn);
  pre.appendChild(code);
  root.appendChild(header);
  root.appendChild(pre);
  return root;
};

const readSliceCode = (sliceRoot: HTMLElement): string =>
  sliceRoot.querySelector("pre code")?.textContent ?? "";

const readSliceNumbers = (sliceRoot: HTMLElement): string[] =>
  Array.from(sliceRoot.querySelectorAll("pre > span > span")).map(
    (number) => number.textContent ?? "",
  );

describe("代码块图片分片", () => {
  test("按行高规划每个分片的行数", () => {
    // 单张上限 6000 CSS 像素、平均行高 20 像素时，每片最多 300 行。
    assert.equal(resolveLinesPerSlice(20, 1000), 300);
    // 行高比单张上限还大时至少保留一行，避免规划出 0 行的分片。
    assert.equal(resolveLinesPerSlice(20000, 10), 1);
    // 没有布局信息时无法估算，整块作为一张图。
    assert.equal(resolveLinesPerSlice(0, 500), 500);
  });

  test("每片保留自己的代码行与原行号，且不带标题栏", () => {
    const codeHtml = [
      '<span class="hljs-keyword">const</span> a = 1',
      '<span class="hljs-keyword">const</span> b = 2',
      '<span class="hljs-string">"three"</span>',
      '<span class="hljs-comment">// four</span>',
      '<span class="hljs-keyword">const</span> e = 5',
    ].join("\n");
    const roots = buildCodeBlockSliceRoots(createCodeBlockDom(codeHtml, 5), 2);

    // 5 行按每片 2 行切分 → 2 + 2 + 1 共三片。
    assert.equal(roots.length, 3);
    assert.deepEqual(roots.map(readSliceCode), [
      "const a = 1\nconst b = 2",
      "\"three\"\n// four",
      "const e = 5",
    ]);
    // 行号与代码行同区间切开：分片仍显示原本的行号，不会从 1 重新编号。
    assert.deepEqual(roots.map(readSliceNumbers), [["1", "2"], ["3", "4"], ["5"]]);
    // 窗口式标题栏不进入任何分片。
    assert.ok(roots.every((root) => !root.querySelector("[data-xmd-code-header]")));
    // 语法高亮标签随分片保留。
    assert.ok(roots[0].querySelector(".hljs-keyword"));
    assert.ok(roots[1].querySelector(".hljs-string"));
  });

  test("跨行的语法高亮元素按行拆开并套回原标签", () => {
    // 跨行块注释在 DOM 里是一个 span 内含换行符，拆行后每行都要保留该 span。
    const codeHtml = '<span class="hljs-comment">/* 第一行\n第二行 */</span>';
    const roots = buildCodeBlockSliceRoots(createCodeBlockDom(codeHtml, 2), 1);

    assert.equal(roots.length, 2);
    assert.equal(readSliceCode(roots[0]), "/* 第一行");
    assert.equal(readSliceCode(roots[1]), "第二行 */");
    assert.equal(roots[0].querySelector("pre code .hljs-comment")?.textContent, "/* 第一行");
    assert.equal(roots[1].querySelector("pre code .hljs-comment")?.textContent, "第二行 */");
  });

  test("自动换行模式下没有行号列也能正常分片", () => {
    const root = createCodeBlockDom("a = 1\nb = 2\nc = 3", 3);
    // 换行模式下编辑器不渲染行号列，这里去掉它模拟真实 DOM。
    root.querySelector("pre > span")?.remove();
    const roots = buildCodeBlockSliceRoots(root, 2);

    assert.equal(roots.length, 2);
    assert.deepEqual(roots.map(readSliceCode), ["a = 1\nb = 2", "c = 3"]);
    assert.equal(roots[0].querySelectorAll("pre > span").length, 0);
  });
});
