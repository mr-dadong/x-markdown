import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getFileName, getDirectoryName, isMarkdownFile } from "./file";

describe("getFileName", () => {
  test("普通文件路径取最后一段文件名", () => {
    assert.equal(getFileName("/home/me/notes/readme.md"), "readme.md");
    assert.equal(getFileName("C:\\docs\\a.md"), "a.md");
  });
  test("null 返回默认名", () => {
    assert.equal(getFileName(null), "未命名.md");
  });
  test("路径以分隔符结尾时返回默认名而非空串", () => {
    // 这是修复点：pop() 得到空串时也要回退，不能返回 ''。
    assert.equal(getFileName("/home/me/notes/"), "未命名.md");
  });
});

describe("getDirectoryName", () => {
  test("提取目录名并忽略结尾分隔符", () => {
    assert.equal(getDirectoryName("/home/me/notes"), "notes");
    assert.equal(getDirectoryName("/home/me/notes/"), "notes");
  });
  test("null 返回默认工作区名", () => {
    assert.equal(getDirectoryName(null), "本地文稿");
  });
});

describe("isMarkdownFile", () => {
  test("识别 .md 与 .markdown，大小写不敏感", () => {
    assert.equal(isMarkdownFile("a.md"), true);
    assert.equal(isMarkdownFile("B.MARKDOWN"), true);
  });
  test("非 Markdown 扩展名返回 false", () => {
    assert.equal(isMarkdownFile("photo.png"), false);
    assert.equal(isMarkdownFile("readme.txt"), false);
  });
});
