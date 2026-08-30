import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getApiKeyDisplay, prefillBaseUrls } from "./aiSettingsForm";
import type { AiProviderPublicConfig } from "../types/ai";

const makeConfig = (
  overrides: Partial<AiProviderPublicConfig> = {},
): AiProviderPublicConfig => ({
  model: "",
  hasApiKey: false,
  ...overrides,
});

describe("prefillBaseUrls", () => {
  const defaults: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    deepseek: "https://api.deepseek.com/v1",
    anthropic: "https://api.anthropic.com/v1",
  };

  test("未配置地址的厂商填入默认地址", () => {
    const result = prefillBaseUrls({ openai: makeConfig() }, defaults);
    assert.equal(result.openai.baseUrl, "https://api.openai.com/v1");
  });

  test("已配置地址的厂商不覆盖", () => {
    const result = prefillBaseUrls(
      { openai: makeConfig({ baseUrl: "https://proxy.example.com/v1" }) },
      defaults,
    );
    assert.equal(result.openai.baseUrl, "https://proxy.example.com/v1");
  });

  test("anthropic 即使默认表里有地址也不预填", () => {
    const result = prefillBaseUrls({ anthropic: makeConfig() }, defaults);
    assert.equal(result.anthropic.baseUrl, undefined);
  });

  test("默认表里没有的厂商保持为空", () => {
    const result = prefillBaseUrls({ custom: makeConfig() }, defaults);
    assert.equal(result.custom.baseUrl, undefined);
  });

  test("不修改传入的原对象", () => {
    const original = { openai: makeConfig() };
    prefillBaseUrls(original, defaults);
    assert.equal(original.openai.baseUrl, undefined);
  });
});

describe("getApiKeyDisplay", () => {
  const mask = "••••••••••••";

  test("已保存 Key 且非编辑态显示掩码", () => {
    assert.equal(getApiKeyDisplay("", false, true, mask), mask);
  });

  test("掩码状态下聚焦进入编辑态显示为空", () => {
    assert.equal(getApiKeyDisplay("", true, true, mask), "");
  });

  test("未配置 Key 时无论编辑与否都显示为空", () => {
    assert.equal(getApiKeyDisplay("", false, false, mask), "");
    assert.equal(getApiKeyDisplay("", true, false, mask), "");
  });

  test("输入草稿后优先显示草稿", () => {
    assert.equal(getApiKeyDisplay("sk-new", true, true, mask), "sk-new");
    assert.equal(getApiKeyDisplay("sk-new", false, true, mask), "sk-new");
  });
});
