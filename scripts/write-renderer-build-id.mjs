import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const rendererDirectory = path.resolve("out/renderer");
const buildIdPath = path.join(rendererDirectory, "build-id.txt");

// 对渲染产物逐个计算摘要；文件名和内容任一变化都会得到新的构建指纹。
async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entryPath !== buildIdPath) {
      files.push(entryPath);
    }
  }

  return files;
}

const files = (await collectFiles(rendererDirectory)).sort();
const hash = createHash("sha256");

for (const filePath of files) {
  const relativePath = path.relative(rendererDirectory, filePath).replaceAll("\\", "/");
  hash.update(relativePath);
  hash.update("\0");
  hash.update(await fs.readFile(filePath));
  hash.update("\0");
}

await fs.writeFile(buildIdPath, `${hash.digest("hex")}\n`, "utf8");

