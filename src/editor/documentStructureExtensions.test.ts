import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  shouldEmitMarkdownUpdate,
  shouldPreventAppendedUpdate,
} from "./documentStructureExtensions";

const createTransaction = (preventUpdate: unknown) => ({
  getMeta: (key: string) => (key === "preventUpdate" ? preventUpdate : undefined),
});

describe("编辑器内部追加事务", () => {
  test("加载文档时继承禁止更新标记", () => {
    assert.equal(
      shouldPreventAppendedUpdate([
        createTransaction(undefined),
        createTransaction(true),
      ]),
      true,
    );
  });

  test("用户编辑事务仍然允许发送更新", () => {
    assert.equal(
      shouldPreventAppendedUpdate([
        createTransaction(undefined),
        createTransaction(false),
      ]),
      false,
    );
  });
});

describe("Markdown 更新来源判断", () => {
  test("编辑器仍有焦点时也禁止加载事务覆盖原文", () => {
    assert.equal(shouldEmitMarkdownUpdate(createTransaction(true), true), false);
  });

  test("无焦点的内部事务不触发文档更新", () => {
    assert.equal(shouldEmitMarkdownUpdate(createTransaction(undefined), false), false);
  });

  test("用户输入和界面编辑事务可以更新文档", () => {
    assert.equal(shouldEmitMarkdownUpdate(createTransaction(undefined), true), true);
    const uiTransaction = {
      getMeta: (key: string) => (key === "uiEvent" ? "paste" : undefined),
    };
    assert.equal(shouldEmitMarkdownUpdate(uiTransaction, false), true);
  });
});
