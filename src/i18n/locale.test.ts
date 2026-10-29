import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isLanguagePreference,
  isUiLocale,
  resolveEffectiveLocale,
  resolveLocale,
} from "./locale";

describe("界面语言解析", () => {
  test("简体中文系统解析为简体中文", () => {
    assert.equal(resolveLocale(["zh-CN"]), "zh-CN");
    assert.equal(resolveLocale(["zh_CN"]), "zh-CN");
  });

  test("繁体中文系统仍解析为简体中文", () => {
    assert.equal(resolveLocale(["zh-TW"]), "zh-CN");
    assert.equal(resolveLocale(["zh-HK"]), "zh-CN");
    assert.equal(resolveLocale(["zh-Hant-TW"]), "zh-CN");
  });

  test("英文系统解析为英文", () => {
    assert.equal(resolveLocale(["en-US"]), "en");
    assert.equal(resolveLocale(["en-GB"]), "en");
  });

  test("不受支持的语言回退英文", () => {
    assert.equal(resolveLocale(["de-DE"]), "en");
    assert.equal(resolveLocale(["fr-FR", "ja-JP"]), "en");
  });

  test("缺少语言信息时回退英文", () => {
    assert.equal(resolveLocale([]), "en");
    assert.equal(resolveLocale(["C"]), "en");
    assert.equal(resolveLocale(["POSIX"]), "en");
    assert.equal(resolveLocale([""]), "en");
  });

  test("按首选顺序选择第一个受支持语言", () => {
    assert.equal(resolveLocale(["fr-FR", "en-US"]), "en");
    assert.equal(resolveLocale(["fr-FR", "zh-CN"]), "zh-CN");
    assert.equal(resolveLocale(["zh-CN", "en-US"]), "zh-CN");
  });

  test("用户显式选择优先于系统语言", () => {
    assert.equal(resolveEffectiveLocale("en", ["zh-CN"]), "en");
    assert.equal(resolveEffectiveLocale("zh-CN", ["en-US"]), "zh-CN");
    assert.equal(resolveEffectiveLocale("system", ["en-US"]), "en");
  });

  test("偏好值与语言的边界校验", () => {
    assert.equal(isUiLocale("zh-CN"), true);
    assert.equal(isUiLocale("en"), true);
    assert.equal(isUiLocale("zh-TW"), false);
    assert.equal(isUiLocale("system"), false);
    assert.equal(isLanguagePreference("system"), true);
    assert.equal(isLanguagePreference("fr"), false);
  });
});
