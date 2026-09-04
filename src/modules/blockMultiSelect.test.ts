import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import {
  blockPositionToIndex,
  computeMultiSelectRange,
  resolveBlockAtClientY,
} from "./blockMultiSelect";

// 飞书式块多选的核心是“把视口 Y 坐标映射到连续的顶层块区间”，
// 这里验证纯计算部分：块索引换算、区间计算、Y 坐标定位与边界收敛。

let browserWindow: Window;
let EditorConstructor: typeof import("@tiptap/core").Editor;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("../editor/editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const createEditor = (markdown: string): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
  });

// 给顶层块元素打桩 getBoundingClientRect，模拟真实布局的连续纵向分布。
// 每个块高 40px，块间留 10px 空隙：块 i 的 top = i * 50，bottom = i * 50 + 40。
const stubBlockRects = (editor: Editor): void => {
  const root = editor.view.dom;
  const children = Array.from(root.children) as HTMLElement[];
  children.forEach((element, index) => {
    const top = index * 50;
    element.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 40,
        height: 40,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  });
};

describe("块 position 换算为子节点索引", () => {
  test("返回块在 doc 子节点中的顺序索引", () => {
    const editor = createEditor("# 标题\n\n段落一\n\n段落二");
    // 标题、段落一、段落二三个顶层块
    assert.equal(editor.state.doc.childCount, 3);
    let position = 0;
    const positions: number[] = [];
    editor.state.doc.forEach((node) => {
      positions.push(position);
      position += node.nodeSize;
    });
    positions.forEach((pos, index) => {
      assert.equal(blockPositionToIndex(editor, pos), index);
    });
  });

  test("不存在的 position 返回 -1", () => {
    const editor = createEditor("段落");
    assert.equal(blockPositionToIndex(editor, 9999), -1);
  });
});

describe("多选区间计算", () => {
  test("正向选择（锚点在上）返回连续区间", () => {
    const editor = createEditor("# 标题\n\n段落一\n\n段落二");
    const doc = editor.state.doc;
    const positions: number[] = [];
    let cursor = 0;
    doc.forEach((node) => {
      positions.push(cursor);
      cursor += node.nodeSize;
    });

    const range = computeMultiSelectRange(editor, positions[0], positions[2]);
    assert.ok(range);
    assert.equal(range.startIndex, 0);
    assert.equal(range.endIndex, 2);
    assert.equal(range.from, positions[0]);
    assert.equal(range.to, positions[2] + doc.child(2).nodeSize);
  });

  test("反向选择（锚点在下）同样取区间，与方向无关", () => {
    const editor = createEditor("甲\n\n乙\n\n丙");
    const positions: number[] = [];
    let cursor = 0;
    editor.state.doc.forEach((node) => {
      positions.push(cursor);
      cursor += node.nodeSize;
    });

    const range = computeMultiSelectRange(editor, positions[2], positions[0]);
    assert.ok(range);
    assert.equal(range.startIndex, 0);
    assert.equal(range.endIndex, 2);
    assert.equal(range.to - range.from, cursor);
  });

  test("锚点与当前块相同表示只选一个块", () => {
    const editor = createEditor("甲\n\n乙\n\n丙");
    const positions: number[] = [];
    let cursor = 0;
    editor.state.doc.forEach((node) => {
      positions.push(cursor);
      cursor += node.nodeSize;
    });

    const range = computeMultiSelectRange(editor, positions[1], positions[1]);
    assert.ok(range);
    assert.equal(range.startIndex, 1);
    assert.equal(range.endIndex, 1);
    assert.equal(range.to - range.from, editor.state.doc.child(1).nodeSize);
  });
});

describe("视口 Y 坐标定位顶层块", () => {
  test("坐标落在块内时返回对应块及其 position", () => {
    const editor = createEditor("# 标题\n\n段落一\n\n段落二");
    stubBlockRects(editor);

    const block = resolveBlockAtClientY(editor, 10);
    assert.ok(block);
    assert.equal(block.isHeading, true);
    assert.equal(block.position, 0);

    const middle = resolveBlockAtClientY(editor, 60);
    assert.ok(middle);
    assert.equal(middle.position, editor.state.doc.child(0).nodeSize);
  });

  test("坐标落在块间空隙时收敛到上方最近的块", () => {
    const editor = createEditor("甲\n\n乙\n\n丙");
    stubBlockRects(editor);

    // 块 0: [0,40]，块 1: [50,90]；45 落在空隙中，应归入块 0。
    const block = resolveBlockAtClientY(editor, 45);
    assert.ok(block);
    assert.equal(block.position, 0);
  });

  test("坐标在文档末尾留白时收敛到最后一个块", () => {
    const editor = createEditor("甲\n\n乙\n\n丙");
    stubBlockRects(editor);

    const block = resolveBlockAtClientY(editor, 500);
    assert.ok(block);
    const lastPosition = (() => {
      let cursor = 0;
      editor.state.doc.forEach((node) => {
        cursor += node.nodeSize;
      });
      return cursor - editor.state.doc.lastChild!.nodeSize;
    })();
    assert.equal(block.position, lastPosition);
  });
});
