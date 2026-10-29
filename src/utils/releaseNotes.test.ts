import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveReleaseNotes } from "./releaseNotes";

const translated = {
  title: "版本更新",
  content: ["修复：示例问题", "新增：示例功能"],
  titleEn: "Version Update",
  contentEn: ["Fixed: an example issue", "Added: an example feature"],
};

describe("更新日志语言选择", () => {
  test("中文界面使用中文标题与条目", () => {
    assert.deepEqual(resolveReleaseNotes(translated, "zh-CN"), {
      title: "版本更新",
      content: translated.content,
      untranslated: false,
    });
  });

  test("英文界面优先使用英文内容", () => {
    assert.deepEqual(resolveReleaseNotes(translated, "en"), {
      title: "Version Update",
      content: translated.contentEn,
      untranslated: false,
    });
  });

  test("英文内容缺失时回退中文并标记未翻译", () => {
    const notes = resolveReleaseNotes(
      { title: "版本更新", content: ["修复：示例问题"] },
      "en",
    );
    assert.equal(notes.title, "版本更新");
    assert.deepEqual(notes.content, ["修复：示例问题"]);
    assert.equal(notes.untranslated, true);
  });
});
