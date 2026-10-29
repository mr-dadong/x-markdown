import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment, setNavigatorLanguages } from "../test/domEnvironment";

let browserWindow: Window;
let useI18nModule: typeof import("./useI18n");
let settingsModule: typeof import("./useSettings");
let nextTick: typeof import("vue").nextTick;

before(async () => {
  browserWindow = installDomEnvironment();
  // 英文系统：跟随系统时渲染层应解析为英文。
  setNavigatorLanguages(["en-US", "en"]);
  Object.defineProperty(browserWindow, "electronAPI", {
    configurable: true,
    value: {
      updateShortcuts: () => undefined,
    },
  });
  useI18nModule = await import("./useI18n");
  settingsModule = await import("./useSettings");
  ({ nextTick } = await import("vue"));
  // 全量测试中模块可能已被其他用例加载过，这里显式重置为英文系统 + 跟随系统。
  setNavigatorLanguages(["en-US", "en"]);
  useI18nModule.setLanguagePreference("system");
});

after(async () => {
  // 模块状态在同进程的测试文件间共享，结束时恢复中文，避免污染其他用例。
  setNavigatorLanguages(["zh-CN"]);
  useI18nModule.setLanguagePreference("system");
  await browserWindow.happyDOM.abort();
});

describe("渲染层语言状态", () => {
  test("跟随系统时使用系统首选语言", () => {
    assert.equal(useI18nModule.locale.value, "en");
    assert.equal(useI18nModule.t("settings.language.title"), "Language");
  });

  test("手动切换到简体中文并持久化", async () => {
    useI18nModule.setLanguagePreference("zh-CN");
    await nextTick();
    assert.equal(useI18nModule.locale.value, "zh-CN");
    assert.equal(settingsModule.useSettings().settings.language, "zh-CN");
    assert.equal(useI18nModule.t("settings.language.title"), "语言");
  });

  test("切回跟随系统时重新按系统语言解析", async () => {
    setNavigatorLanguages(["zh-CN"]);
    useI18nModule.setLanguagePreference("system");
    await nextTick();
    assert.equal(useI18nModule.locale.value, "zh-CN");

    setNavigatorLanguages(["en-GB"]);
    useI18nModule.setLanguagePreference("system");
    await nextTick();
    assert.equal(useI18nModule.locale.value, "en");
  });
});
