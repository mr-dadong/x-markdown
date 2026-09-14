import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// 路径授权是主进程的安全边界：渲染进程只能读取用户明确选过的范围。
// 同时它也要覆盖「从侧栏文件树打开文档」这类合法场景，否则文档内容能读、
// 同级图片/附件却读不到，编辑器会报「无权访问该文件，请先通过打开对话框选择它」。
//
// 这里直接测 electron/services/pathAccess 的授权语义。授权状态是模块级集合，
// 因此把每个用例放在互不重叠的临时目录里，避免互相干扰。

let authorizeDocument: typeof import("./pathAccess").authorizeDocument;
let authorizeDirectory: typeof import("./pathAccess").authorizeDirectory;
let assertAuthorizedPath: typeof import("./pathAccess").assertAuthorizedPath;

const createdRoots: string[] = [];

/** 建一个独立临时目录，返回目录路径与一个写好的文件路径。 */
const createSandbox = (name: string): { root: string; file: string } => {
  const root = mkdtempSync(path.join(tmpdir(), `xmd-pathaccess-${name}-`));
  createdRoots.push(root);
  const file = path.join(root, "document.md");
  writeFileSync(file, "# 标题", "utf-8");
  return { root, file };
};

before(async () => {
  ({ authorizeDocument, authorizeDirectory, assertAuthorizedPath } = await import("./pathAccess"));
});

after(() => {
  for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
});

describe("路径授权", () => {
  test("未授权的路径会被拒绝，并给出可理解的提示", () => {
    const { file } = createSandbox("unauthorized");
    assert.throws(
      () => assertAuthorizedPath(file),
      /无权访问该文件/u,
    );
  });

  test("授权目录后，目录内文件可读", () => {
    const { root, file } = createSandbox("directory");
    authorizeDirectory(root);
    assert.equal(assertAuthorizedPath(file), file);
  });

  test("authorizeDocument 同时放通文档本身与同级资源", () => {
    const { root, file } = createSandbox("document");
    const imagePath = path.join(root, "assets", "icon.png");
    mkdirSync(path.dirname(imagePath), { recursive: true });
    writeFileSync(imagePath, "binary", "utf-8");

    // 授权前：图片不可读（这正是「打开文件报 read-editor-image 无权访问」的成因）
    assert.throws(() => assertAuthorizedPath(imagePath), /无权访问该文件/u);

    authorizeDocument(file);

    // 授权后：文档与同级图片都可读
    assert.equal(assertAuthorizedPath(file), file);
    assert.equal(assertAuthorizedPath(imagePath), imagePath);
  });

  test("授权不会越过目录边界：父目录与无关目录仍被拒绝", () => {
    const { root, file } = createSandbox("boundary");
    const siblingRoot = createSandbox("boundary-other");
    authorizeDocument(file);

    // 文档所在目录的父目录不属于授权范围
    assert.throws(
      () => assertAuthorizedPath(path.join(path.dirname(root), "outside.md")),
      /无权访问该文件/u,
    );
    // 另一个完全无关的目录也不应被放通
    assert.throws(
      () => assertAuthorizedPath(siblingRoot.file),
      /无权访问该文件/u,
    );
  });

  test("路径比较不受大小写与相对写法影响（同一文件重复授权仍然可读）", () => {
    const { file } = createSandbox("normalize");
    authorizeDocument(file);
    // 带 .. 的相对写法解析后仍是同一路径，应判定为已授权
    const roundabout = path.join(path.dirname(file), "sub", "..", "document.md");
    assert.equal(assertAuthorizedPath(roundabout), file);
  });
});
