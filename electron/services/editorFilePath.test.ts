import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// 文档里的资源地址如何解析成磁盘路径，直接影响图片/附件能否读出来。
//
// 这条链路曾出错在「以 / 开头的地址」上：Markdown 里写 `/fav_error.png` 时，
// path.resolve 会把它当成当前盘符根目录（C:\fav_error.png），
// 既不是图片真实位置，又落在授权范围之外，
// 于是报出与真实原因无关的「无权访问该文件，请先通过打开对话框选择它」。
//
// 注意：授权状态是模块级全局集合，测试之间会互相影响。
// 因此每个用例只授权自己沙箱内部的目录，绝不授权 os.tmpdir() 这类共享父目录，
// 否则别的用例会意外变成「已授权」而失去意义。

let resolveEditorFilePath: typeof import("./editorFilePath").resolveEditorFilePath;
let authorizeDocument: typeof import("./pathAccess").authorizeDocument;

const createdRoots: string[] = [];

/** 建一个独立沙箱，返回根目录与放在其中的文档路径。 */
const createSandbox = (name: string): { root: string; documentPath: string } => {
  const root = mkdtempSync(path.join(tmpdir(), `xmd-editorfile-${name}-`));
  createdRoots.push(root);
  const documentPath = path.join(root, "111.md");
  writeFileSync(documentPath, "# 标题", "utf-8");
  return { root, documentPath };
};

before(async () => {
  ({ resolveEditorFilePath } = await import("./editorFilePath"));
  ({ authorizeDocument } = await import("./pathAccess"));
});

after(() => {
  for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
});

describe("文档资源地址解析", () => {
  test("相对地址按文档所在目录解析", () => {
    const { root, documentPath } = createSandbox("relative");
    authorizeDocument(documentPath);
    assert.equal(
      resolveEditorFilePath("assets/a.png", documentPath),
      path.join(root, "assets", "a.png"),
    );
  });

  test("上跳地址按文档所在目录解析（父目录授权后可用）", () => {
    // 文档放在 <root>/docs 下，父目录 <root> 也在沙箱内，
    // 授权 <root> 不会影响其它用例。
    const { root } = createSandbox("parent");
    const docsDirectory = path.join(root, "docs");
    mkdirSync(docsDirectory, { recursive: true });
    const documentPath = path.join(docsDirectory, "111.md");
    writeFileSync(documentPath, "# 标题", "utf-8");

    // 只授权 docs 时，上跳到 <root> 属于越界，应被拒绝
    authorizeDocument(documentPath);
    assert.throws(
      () => resolveEditorFilePath("../a.png", documentPath),
      /无权访问该文件/u,
    );

    // 授权 <root>（例如用户把它选为工作区）后，上跳地址即可正常解析
    authorizeDocument(path.join(root, "workspace.md"));
    assert.equal(
      resolveEditorFilePath("../a.png", documentPath),
      path.join(root, "a.png"),
    );
  });

  // 以 / 开头在 Windows 上是盘符根写法，语义修复只在 Windows 上有意义。
  test(
    "以 / 开头的地址按文档所在目录解析，而不是盘符根目录",
    { skip: process.platform !== "win32" ? "仅在 Windows 上语义不同" : false },
    () => {
      const { root, documentPath } = createSandbox("leading-slash");
      authorizeDocument(documentPath);

      const resolved = resolveEditorFilePath("/fav_error.png", documentPath);

      // 修复前是 C:\fav_error.png（盘符根，且必然落在授权范围之外）
      assert.equal(resolved, path.join(root, "fav_error.png"));
      assert.notEqual(resolved, path.resolve(path.parse(root).root, "fav_error.png"));
    },
  );

  test(
    "盘符绝对路径保持绝对语义，不被当成相对地址",
    { skip: process.platform !== "win32" ? "仅在 Windows 上涉及盘符" : false },
    () => {
      const { documentPath } = createSandbox("drive");
      authorizeDocument(documentPath);
      // 盘符根不在授权范围内，应被拒绝（说明它没被改写成文档目录下的相对路径）
      assert.throws(
        () => resolveEditorFilePath("C:/windows/not-authorized.png", documentPath),
        /无权访问该文件/u,
      );
    },
  );

  test("file:// 地址按绝对路径处理", () => {
    const { root, documentPath } = createSandbox("file-url");
    authorizeDocument(documentPath);
    const fileUrl = new URL(`file://${path.join(root, "a.png").replace(/\\/gu, "/")}`).href;
    assert.equal(resolveEditorFilePath(fileUrl, documentPath), path.join(root, "a.png"));
  });

  test("未被授权的文档会被拒绝（安全边界不变）", () => {
    const { documentPath } = createSandbox("unauthorized-doc");
    assert.throws(
      () => resolveEditorFilePath("/fav_error.png", documentPath),
      /无权访问该文件/u,
    );
  });

  test("相对地址无法逃逸到授权目录之外", () => {
    const { documentPath } = createSandbox("escape");
    const outside = createSandbox("escape-other");
    authorizeDocument(documentPath);
    const escapeUrl = path
      .relative(path.dirname(documentPath), outside.documentPath)
      .replace(/\\/gu, "/");
    assert.throws(
      () => resolveEditorFilePath(escapeUrl, documentPath),
      /无权访问该文件/u,
    );
  });

  test("没有当前文档时以进程工作目录为基准（未授权则拒绝）", () => {
    // 未保存文档没有所在目录，只能以工作目录为基准。
    // 工作目录是否可用取决于用户是否把它选为工作区，两种结果都正确：
    // 授权了就按工作目录解析，没授权就拒绝，不能因此放开任意路径读取。
    const expected = path.resolve(process.cwd(), "a.png");
    try {
      assert.equal(resolveEditorFilePath("a.png", null), expected);
    } catch (error) {
      assert.match((error as Error).message, /无权访问该文件/u);
    }
  });
});
