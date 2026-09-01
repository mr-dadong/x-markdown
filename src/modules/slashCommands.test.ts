import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { installDomEnvironment } from "../test/domEnvironment";

let filterSlashCommands: typeof import("./slashCommands").filterSlashCommands;

before(async () => {
  const browserWindow = installDomEnvironment();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: browserWindow.localStorage,
  });
  Object.defineProperty(browserWindow, "electronAPI", {
    configurable: true,
    value: {
      updateShortcuts: () => undefined,
    },
  });
  ({ filterSlashCommands } = await import("./slashCommands"));
});

describe("斜杠命令搜索排序", () => {
  test("输入 ai 时优先选择 AI 实时编写", () => {
    const commands = filterSlashCommands("ai");

    assert.equal(commands[0]?.id, "ai-write");
    assert.equal(commands.some((command) => command.id === "code-block"), true);
  });
});
