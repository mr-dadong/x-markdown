import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { undoDepth } from "@tiptap/pm/history";
import { installDomEnvironment } from "../test/domEnvironment";

let browserWindow: Window;
let useMarkdownEditor: typeof import("./useEditor").useMarkdownEditor;
type EditorHandle = ReturnType<typeof useMarkdownEditor>;

let createApp: typeof import("vue").createApp;
let defineComponent: typeof import("vue").defineComponent;
let h: typeof import("vue").h;
let nextTick: typeof import("vue").nextTick;
let ref: typeof import("vue").ref;

before(async () => {
  browserWindow = installDomEnvironment();
  // useSettings 在模块加载时立即向主进程同步快捷键，必须先准备好 mock。
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
  ({ createApp, defineComponent, h, nextTick, ref } = await import("vue"));
  ({ useMarkdownEditor } = await import("./useEditor"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

// 用响应式内容承载“当前文档”：改写文档即切换/新建文档，触发 useMarkdownEditor 内部
// 对 getContent 的 watch，从而走一遍 setContent + 清空撤销历史的完整流程。
const mountEditor = async (): Promise<{
  handle: EditorHandle;
  switchTo: (content: string) => Promise<void>;
  unmount: () => Promise<void>;
}> => {
  let handle!: EditorHandle;
  const content = ref("文档A初始内容");
  const component = defineComponent({
    setup() {
      handle = useMarkdownEditor(
        () => content.value,
        // 不向文档层发送更新，避免与“切换文档数组”的回跳逻辑混在一起。
        () => undefined,
        () => null,
        () => true,
      );
      return () => h("div");
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(component);
  app.mount(container);
  await nextTick();
  assert.ok(handle.editor.value, "编辑器应在挂载后创建");
  return {
    handle,
    switchTo: async (newContent: string) => {
      content.value = newContent;
      await nextTick();
    },
    unmount: async () => {
      await nextTick();
      app.unmount();
      container.remove();
    },
  };
};

describe("切换文档后撤销/重做历史", () => {
  test("切换到新文档后历史被清空，撤销不会回退到上一个文档", async () => {
    const { handle, switchTo, unmount } = await mountEditor();
    try {
      const editor = handle.editor.value!;

      // 在“文档A”里输入两段内容，制造可撤销的历史。
      editor.chain().focus().insertContent("第一条").run();
      editor.chain().insertContent("第二条").run();
      assert.ok(undoDepth(editor.state) > 0, "输入后应产生可撤销的历史");

      // 打开/切换到“文档B”：触发 watch，走 setContent + 清空撤销历史的流程。
      await switchTo("文档B的内容");

      // 正文已替换为新文档。
      assert.equal(editor.state.doc.textContent, "文档B的内容");
      // 撤销/重做历史应为空：新文档不得残留上一个文档的撤销记录。
      assert.equal(undoDepth(editor.state), 0, "切换文档后撤销栈应为空");
      // 历史为空时撤销不生效，避免把“文档B”回退成“文档A”的内容。
      assert.equal(editor.commands.undo(), false, "历史为空时撤销不应生效");
      assert.equal(
        editor.state.doc.textContent,
        "文档B的内容",
        "撤销不应改动新文档内容",
      );
    } finally {
      await unmount();
    }
  });

  test("切到新文档后重新输入，撤销只回退新文档自身的输入", async () => {
    const { handle, switchTo, unmount } = await mountEditor();
    try {
      const editor = handle.editor.value!;
      editor.chain().focus().insertContent("文档A遗留").run();

      await switchTo("文档B开头");
      // 在新文档里继续输入，产生一条属于自己的可撤销记录。
      editor.chain().insertContent("追加").run();
      assert.equal(
        undoDepth(editor.state),
        1,
        "新文档输入后应只有一条可撤销记录",
      );

      // 撤销一次只回退新文档里的“追加”，而不是回到文档A。
      editor.commands.undo();
      assert.equal(
        editor.state.doc.textContent,
        "文档B开头",
        "撤销应只回退新文档的输入",
      );
      // 再撤销应无内容可退，正文保持“文档B开头”不变。
      assert.equal(editor.commands.undo(), false);
      assert.equal(editor.state.doc.textContent, "文档B开头");
    } finally {
      await unmount();
    }
  });
});