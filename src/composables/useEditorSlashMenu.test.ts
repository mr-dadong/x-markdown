import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { TextSelection } from "@tiptap/pm/state";
import { installDomEnvironment } from "../test/domEnvironment";
import type { SlashRange } from "../modules/slashCommands";

let browserWindow: Window;
let useMarkdownEditor: typeof import("./useEditor").useMarkdownEditor;
type EditorHandle = ReturnType<typeof useMarkdownEditor>;

// vue 的 runtime-dom 在模块加载时捕获 document，必须先装好 DOM 环境再加载 vue。
let createApp: typeof import("vue").createApp;
let defineComponent: typeof import("vue").defineComponent;
let h: typeof import("vue").h;
let nextTick: typeof import("vue").nextTick;

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
  ({ createApp, defineComponent, h, nextTick } = await import("vue"));
  ({ useMarkdownEditor } = await import("./useEditor"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

// useTiptapEditor 在 onMounted 中创建编辑器，因此挂载一个最小 Vue 组件来承载组合式函数。
const mountEditor = async (
  content: string,
  onOpenAiWriter?: (range: SlashRange) => void,
): Promise<{ handle: EditorHandle; unmount: () => Promise<void> }> => {
  let handle!: EditorHandle;
  const component = defineComponent({
    setup() {
      handle = useMarkdownEditor(
        () => content,
        () => undefined,
        () => null,
        () => true,
        onOpenAiWriter,
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
    // 面板定位使用 nextTick 延迟执行，卸载前先让这些回调跑完，避免在已销毁的视图上取坐标。
    unmount: async () => {
      await nextTick();
      app.unmount();
      container.remove();
    },
  };
};

describe("斜杠命令面板的弹出时机与回车行为", () => {
  test("输入 /aaa 时弹出面板，查询无匹配命令", async () => {
    const { handle, unmount } = await mountEditor("");
    try {
      handle.editor.value!.chain().focus().insertContent("/aaa").run();

      assert.equal(handle.slashMenuVisible.value, true);
      assert.equal(handle.slashQuery.value, "aaa");
      assert.equal(handle.filteredCommands.value.length, 0);
    } finally {
      await unmount();
    }
  });

  test("在代码块中输入斜杠不弹出斜杠面板", async () => {
    const { handle, unmount } = await mountEditor("");
    try {
      // 斜杠先落在空段落，随后在代码块里输入 / 注释，两种情况都不应弹出面板。
      handle.editor.value!.chain().focus().setCodeBlock().insertContent("/aaa").run();

      assert.equal(handle.slashMenuVisible.value, false, "代码块内的斜杠不应触发斜杠面板");
    } finally {
      await unmount();
    }
  });

  test("光标移入代码块时关闭已打开的斜杠面板", async () => {
    const { handle, unmount } = await mountEditor("");
    try {
      handle.editor.value!.chain().focus().insertContent("/aaa").run();
      assert.equal(handle.slashMenuVisible.value, true);

      // 光标定位到代码块开头，模拟从段落点击/移动到代码块内。
      handle.editor.value!.chain().setCodeBlock().run();

      assert.equal(handle.slashMenuVisible.value, false, "光标进入代码块后面板应关闭");
    } finally {
      await unmount();
    }
  });

  test("退格合并两行后光标停在 /aaa 后面不再弹出面板", async () => {
    const { handle, unmount } = await mountEditor("/aaa\n\n第二行");
    try {
      const editor = handle.editor.value!;
      // 光标定位到第二行开头（段落边界的后一个内联位置），模拟回车到下一行后的状态。
      const secondParagraphStart = editor.state.doc.child(0).nodeSize;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, secondParagraphStart + 1),
        ),
      );
      // 退格合并两行：join 与退格键走同一条合并路径，正文拼成一段。
      editor.view.dispatch(editor.state.tr.join(secondParagraphStart));
      // 合并后光标停在第一行 "/aaa" 结尾（衔接处）。
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, secondParagraphStart - 1),
        ),
      );

      assert.equal(editor.state.doc.textContent, "/aaa第二行", "两行应合并成一段");
      assert.equal(
        editor.state.doc.textBetween(0, editor.state.selection.from, "\n"),
        "/aaa",
        "合并后光标应停在 /aaa 后面",
      );
      assert.equal(
        handle.slashMenuVisible.value,
        false,
        "删除类操作不应重新弹出斜杠面板",
      );
    } finally {
      await unmount();
    }
  });

  test("没有匹配的命令时回车关闭面板并放行换行", async () => {
    const { handle, unmount } = await mountEditor("");
    try {
      handle.editor.value!.chain().focus().insertContent("/aaa").run();
      assert.equal(handle.slashMenuVisible.value, true);

      const EventConstructor = browserWindow
        .KeyboardEvent as unknown as typeof KeyboardEvent;
      const event = new EventConstructor("keydown", {
        key: "Enter",
        cancelable: true,
      });
      const handled = handle.handleSlashMenuKeydown(event);

      assert.equal(handled, false, "无匹配命令时不应吞掉回车");
      assert.equal(handle.slashMenuVisible.value, false, "回车应同时关闭面板");
    } finally {
      await unmount();
    }
  });

  test("有匹配的命令时回车仍然执行选中命令", async () => {
    const openedRanges: SlashRange[] = [];
    const { handle, unmount } = await mountEditor("", (range) => {
      openedRanges.push(range);
    });
    try {
      handle.editor.value!.chain().focus().insertContent("/ai").run();
      assert.ok(handle.filteredCommands.value.length > 0, "/ai 应有匹配命令");

      const EventConstructor = browserWindow
        .KeyboardEvent as unknown as typeof KeyboardEvent;
      const event = new EventConstructor("keydown", {
        key: "Enter",
        cancelable: true,
      });
      const handled = handle.handleSlashMenuKeydown(event);

      assert.equal(handled, true, "有匹配命令时回车应执行命令");
      assert.equal(openedRanges.length, 1, "应触发 AI 实时编写");
      assert.equal(handle.slashMenuVisible.value, false, "执行命令后面板应关闭");
    } finally {
      await unmount();
    }
  });
});
