import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { en } from "./messages/en";
import { zhCN } from "./messages/zh-CN";
import { translate } from "./translate";

describe("词表与翻译", () => {
  test("中英词表的 key 完全一致", () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zhCN).sort());
  });

  test("英文词表不含中文字符", () => {
    for (const [key, value] of Object.entries(en)) {
      assert.equal(
        /[\u4e00-\u9fff]/.test(value),
        false,
        `英文词表包含中文：${key} -> ${value}`,
      );
    }
  });

  test("中文词表没有空值", () => {
    for (const [key, value] of Object.entries(zhCN)) {
      assert.notEqual(value.trim(), "", `中文词表存在空值：${key}`);
    }
  });

  test("英文词表没有空值", () => {
    for (const [key, value] of Object.entries(en)) {
      assert.notEqual(value.trim(), "", `英文词表存在空值：${key}`);
    }
  });

  test("按语言替换占位符", () => {
    assert.equal(translate("zh-CN", "status.lines", { count: 12 }), "12 行");
    assert.equal(translate("en", "status.lines", { count: 12 }), "Lines: 12");
    assert.equal(translate("en", "status.characters", { count: 3 }), "Characters: 3");
  });

  test("缺少占位参数时抛出异常", () => {
    assert.throws(() => translate("en", "status.lines"), /missing parameter/);
  });

  test("双大括号渲染为字面量，不参与插值", () => {
    assert.equal(
      translate("zh-CN", "settings.footerPlaceholder"),
      "页脚（例如：第 ${pageNo} / ${pageCount} 页）",
    );
    assert.equal(
      translate("en", "settings.headerFooter.description"),
      "Leave blank to skip printing. Placeholders: ${pageNo}, ${pageCount}, ${title}, ${date}.",
    );
    assert.equal(
      translate("zh-CN", "settings.headerFooter.description"),
      "留空表示不打印。可用 ${pageNo}、${pageCount}、${title}、${date} 占位符。",
    );
  });
});
