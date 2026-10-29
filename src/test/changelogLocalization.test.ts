import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// 更新日志来自远程清单，本地 JSON 是唯一可提前校验的源数据。
const changelogDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../changelogs",
);
const releaseFiles = fs
  .readdirSync(changelogDirectory)
  .filter((name) => /^v\d+\.\d+\.\d+\.json$/u.test(name))
  .sort();

describe("更新日志双语完整性", () => {
  test("每个版本都提供与中文等长的英文标题与条目", () => {
    assert.ok(releaseFiles.length > 0, "未找到任何版本清单");
    for (const fileName of releaseFiles) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(changelogDirectory, fileName), "utf-8"),
      ) as {
        releases: Array<{
          version: string;
          title: string;
          content: string[];
          titleEn?: string;
          contentEn?: string[];
        }>;
      };
      const release = manifest.releases[0];
      assert.ok(release.titleEn?.trim(), `${fileName} 缺少英文标题`);
      assert.ok(Array.isArray(release.contentEn), `${fileName} 缺少英文条目`);
      assert.equal(
        release.contentEn?.length,
        release.content.length,
        `${fileName} 中英条目数量不一致`,
      );
      for (const item of release.contentEn ?? []) {
        assert.ok(item.trim(), `${fileName} 存在空英文条目`);
        assert.equal(
          /[\u4e00-\u9fff]/u.test(item),
          false,
          `${fileName} 英文条目包含中文：${item}`,
        );
      }
    }
  });
});
