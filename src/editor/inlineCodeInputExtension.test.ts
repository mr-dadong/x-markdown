import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  findClosingBacktickOffset,
  handleOpeningBacktickInput,
  safeInlineCodeInputRegex,
} from "./inlineCodeInputExtension";

describe("行内代码反向输入", () => {
  test("正向输入行内代码时不消费左侧普通字符", () => {
    const match = safeInlineCodeInputRegex.exec("dd`d`");

    assert.equal(match?.[0], "`d`");
    assert.equal(match?.[1], "d");
  });

  test("最后补左侧反引号时识别已有的结束反引号", () => {
    assert.equal(findClosingBacktickOffset("dd`"), 2);
    assert.equal(findClosingBacktickOffset("/2*b2` 后续文字"), 5);
  });

  test("空内容、转义反引号和连续反引号保持普通输入", () => {
    assert.equal(findClosingBacktickOffset("`"), null);
    assert.equal(findClosingBacktickOffset("dd\\`"), null);
    assert.equal(findClosingBacktickOffset("dd``"), null);
    assert.equal(findClosingBacktickOffset("没有结束符"), null);
  });

  test("输入左侧反引号后删除两侧标记并添加代码格式", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
      marks: { code: {} },
    });
    const document = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("dd`")]),
    ]);
    let state = EditorState.create({
      schema,
      doc: document,
      selection: TextSelection.create(document, 1),
    });
    const handled = handleOpeningBacktickInput(
      {
        get state() {
          return state;
        },
        dispatch(transaction) {
          state = state.apply(transaction);
        },
      },
      1,
      1,
      "`",
    );

    assert.equal(handled, true);
    assert.equal(state.doc.textContent, "dd");
    assert.equal(state.doc.firstChild?.firstChild?.marks[0]?.type.name, "code");
    assert.equal(state.selection.from, 3);
  });
});
