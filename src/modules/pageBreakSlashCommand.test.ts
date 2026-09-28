import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

let browserWindow: Window;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;
let slashCommands: typeof import("./slashCommands").slashCommands;

before(async () => {
  browserWindow = installDomEnvironment();
  // useSettings 在模块加载时会读取 localStorage 并同步快捷键，必须先准备好 mock。
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: browserWindow.localStorage,
  });
  Object.defineProperty(browserWindow, "electronAPI", {
    configurable: true,
    value: { updateShortcuts: () => undefined },
  });
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("../editor/editorExtensions"));
  ({ slashCommands } = await import("./slashCommands"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const waitForCreate = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

const createEditor = (): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: "",
    contentType: "markdown",
  });

test("斜杠命令里的分页符插入后写出标准分页源码", async () => {
  const editor = createEditor();
  await waitForCreate();

  const command = slashCommands.find((item) => item.id === "page-break");
  assert.ok(command, "应当存在 id 为 page-break 的斜杠命令");

  // 斜杠菜单会先删掉用户输入的 "/分页"，这里用空 range 模拟。
  await command.run?.(editor, { from: 1, to: 1 }, null);

  assert.equal(
    editor.getMarkdown(),
    '<div style="page-break-after: always"></div>\n\n',
    "插入后应写出与 Typora 一致的标准分页符源码",
  );

  // 分页符是原子块节点，后面必须留出可继续输入正文的段落。
  const types: string[] = [];
  editor.state.doc.forEach((node) => types.push(node.type.name));
  assert.deepEqual(types, ["pageBreak", "paragraph"]);

  editor.destroy();
});
