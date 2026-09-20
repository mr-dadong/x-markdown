import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

// 手写的裸文件链接（如 [redis8_migrate.tar.gz](图片和附件/redis8_migrate.tar.gz)）
// 命中附件后缀且独占段落时，应增强为文件卡片节点；
// 混排文字、网络地址、图片后缀与带 title 的链接保持普通链接不变。

let browserWindow: Window;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
    browserWindow = installDomEnvironment();
    // 附件卡片视图会通过 electronAPI 查询本地文件是否存在与大小，测试里给一个最小替身。
    (browserWindow as unknown as { electronAPI: unknown }).electronAPI = {
        editorFileStat: async () => ({ exists: true, size: 0 }),
        onAttachmentCopyProgress: () => () => { },
        getPathForFile: () => "",
    };
    ({ Editor: EditorConstructor } = await import("@tiptap/core"));
    ({ createEditorExtensions } = await import("../editor/editorExtensions"));
});

after(async () => {
    await browserWindow.happyDOM.abort();
});

const withEditor = <T>(
    content: string,
    inspect: (editor: InstanceType<typeof EditorConstructor>) => T,
): T => {
    const editor = new EditorConstructor({ extensions: createEditorExtensions(), content, contentType: "markdown" });
    try {
        return inspect(editor);
    } finally {
        editor.destroy();
    }
};

// 收集文档中全部附件节点的属性，用于断言链接是否被增强为卡片。
const attachmentAttrs = (
    editor: InstanceType<typeof EditorConstructor>,
): Array<Record<string, unknown>> => {
    const attrs: Array<Record<string, unknown>> = [];
    editor.state.doc.descendants((node) => {
        if (node.type.name === "attachment") attrs.push(node.attrs);
        return true;
    });
    return attrs;
};

// 判断文档中是否仍存在指向目标地址的普通链接（未被增强为卡片）。
const hasTextLink = (
    editor: InstanceType<typeof EditorConstructor>,
    href: string,
): boolean => {
    let found = false;
    editor.state.doc.descendants((node) => {
        if (node.marks.some((mark) => mark.type.name === "link" && mark.attrs.href === href)) {
            found = true;
        }
        return true;
    });
    return found;
};

describe("手写文件链接增强为附件卡片", () => {
    test("独占段落的压缩包链接转换为附件节点", () => {
        const attrs = withEditor(
            "[redis8_migrate.tar.gz](图片和附件/redis8_migrate.tar.gz)",
            attachmentAttrs,
        );
        assert.equal(attrs.length, 1);
        assert.equal(attrs[0].fileName, "redis8_migrate.tar.gz");
        assert.equal(attrs[0].fileType, "gz");
        assert.equal(attrs[0].fileSize, 0);
        // markdown-it 会把中文路径百分号编码，卡片保存的是编码后的地址。
        assert.equal(attrs[0].url, "%E5%9B%BE%E7%89%87%E5%92%8C%E9%99%84%E4%BB%B6/redis8_migrate.tar.gz");
    });

    test("文档类后缀也会转换，类型取最后一段扩展名", () => {
        const attrs = withEditor("[说明书](./files/manual.pdf)", attachmentAttrs);
        assert.equal(attrs.length, 1);
        assert.equal(attrs[0].fileName, "说明书");
        assert.equal(attrs[0].fileType, "pdf");
    });

    test("与文字混排的链接保持普通链接，不拆散段落", () => {
        const result = withEditor("请下载 [归档](assets/backup.zip) 后解压", (editor) => ({
            attrs: attachmentAttrs(editor),
            keepsLink: hasTextLink(editor, "assets/backup.zip"),
        }));
        assert.equal(result.attrs.length, 0);
        assert.equal(result.keepsLink, true);
    });

    test("网络地址与图片后缀不转换", () => {
        const result = withEditor(
            ["[在线版](https://example.com/file.zip)", "", "[截图](assets/screen.png)"].join("\n"),
            (editor) => ({
                attrs: attachmentAttrs(editor),
                keepsWebLink: hasTextLink(editor, "https://example.com/file.zip"),
                keepsImageLink: hasTextLink(editor, "assets/screen.png"),
            }),
        );
        assert.equal(result.attrs.length, 0);
        assert.equal(result.keepsWebLink, true);
        assert.equal(result.keepsImageLink, true);
    });

    test("带自定义 title 的链接不转换，避免吞掉用户备注", () => {
        const result = withEditor('[数据](data.zip "备注")', (editor) => ({
            attrs: attachmentAttrs(editor),
            keepsLink: hasTextLink(editor, "data.zip"),
        }));
        assert.equal(result.attrs.length, 0);
        assert.equal(result.keepsLink, true);
    });

    test("增强后保存为带元数据的标准链接，重新打开仍是卡片", () => {
        const saved = withEditor(
            "[redis8_migrate.tar.gz](图片和附件/redis8_migrate.tar.gz)",
            (editor) => editor.getMarkdown() as string,
        );
        // 序列化补充了 XMD 附件元数据 title，其他编辑器仍是标准链接。
        assert.ok(saved.includes('[redis8_migrate.tar.gz](<%E5%9B%BE%E7%89%87%E5%92%8C%E9%99%84%E4%BB%B6/redis8_migrate.tar.gz> "xmd-attachment:'));
        const reopened = withEditor(saved, attachmentAttrs);
        assert.equal(reopened.length, 1);
        assert.equal(reopened[0].fileType, "gz");
    });

    test("XMD 生成的附件元数据链接仍按元数据解析", () => {
        const attrs = withEditor(
            '[说明书](./files/manual.pdf "xmd-attachment:%7B%22fileSize%22%3A2048%2C%22fileType%22%3A%22pdf%22%7D")',
            attachmentAttrs,
        );
        assert.equal(attrs.length, 1);
        assert.equal(attrs[0].fileSize, 2048);
        assert.equal(attrs[0].fileType, "pdf");
    });
});
