import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const changelogDirectory = path.join(projectRoot, "changelogs");
const packageFile = path.join(projectRoot, "package.json");
const cnbReleaseBaseUrl =
  "https://cnb.cool/X-2026/x-markdown/-/releases/download";

// 只接受项目当前使用的三段式正式版本，避免生成无法对应发布标签的文件。
function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`package.json 中的版本号 ${version} 不是 x.y.z 格式`);
  }
}

function createDownloads(version) {
  const releaseUrl = `${cnbReleaseBaseUrl}/v${version}`;

  return {
    windows: {
      available: true,
      requirements: "Windows 10 或 Windows 11",
      packages: [
        {
          arch: "x64",
          format: "exe",
          installer: "NSIS",
          filename: `XMD-${version}-Windows-x64.exe`,
          url: `${releaseUrl}/XMD-${version}-Windows-x64.exe`,
          sha256: null,
        },
      ],
    },
    macos: {
      available: true,
      requirements: "macOS 12 或更高版本",
      packages: [
        {
          arch: "arm64",
          format: "dmg",
          installer: "DMG",
          filename: `XMD-${version}-macOS-arm64.dmg`,
          url: `${releaseUrl}/XMD-${version}-macOS-arm64.dmg`,
          sha256: null,
        },
        {
          arch: "x64",
          format: "dmg",
          installer: "DMG",
          filename: `XMD-${version}-macOS-x64.dmg`,
          url: `${releaseUrl}/XMD-${version}-macOS-x64.dmg`,
          sha256: null,
        },
      ],
    },
    linux: {
      available: true,
      requirements: "主流 64 位 Linux 发行版",
      packages: [
        {
          arch: "x64",
          format: "AppImage",
          installer: "AppImage",
          filename: `XMD-${version}-Linux-x86_64.AppImage`,
          url: `${releaseUrl}/XMD-${version}-Linux-x86_64.AppImage`,
          sha256: null,
        },
        {
          arch: "arm64",
          format: "AppImage",
          installer: "AppImage",
          filename: `XMD-${version}-Linux-arm64.AppImage`,
          url: `${releaseUrl}/XMD-${version}-Linux-arm64.AppImage`,
          sha256: null,
        },
      ],
    },
  };
}

function getShanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getReleasePackages(release) {
  if (!release.downloads || typeof release.downloads !== "object") {
    throw new Error(`版本 ${release.version} 缺少 downloads 配置`);
  }

  return Object.values(release.downloads).flatMap((platform) =>
    Array.isArray(platform.packages) ? platform.packages : [],
  );
}

function validateReleaseHashes(release, fileName) {
  const packages = getReleasePackages(release);
  for (const releasePackage of packages) {
    if (!releasePackage.filename || !releasePackage.url) continue;
    if (!/^[a-f\d]{64}$/iu.test(releasePackage.sha256 ?? "")) {
      throw new Error(`${fileName} 中 ${releasePackage.filename} 缺少有效的 SHA-256`);
    }
  }
}

async function calculateFileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = rightParts[index] - leftParts[index];
    if (difference !== 0) return difference;
  }

  return 0;
}

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createChangelog() {
  const packageJson = await readJson(packageFile);
  const version = packageJson.version;
  validateVersion(version);

  const targetFile = path.join(changelogDirectory, `v${version}.json`);

  // 使用 wx 模式创建文件，目标文件存在时直接报错且不会覆盖原内容。
  const changelog = {
    latest: version,
    releases: [
      {
        version,
        date: getShanghaiDate(),
        channel: "stable",
        title: "版本更新",
        content: [],
        downloads: createDownloads(version),
      },
    ],
  };

  await writeFile(
    targetFile,
    `${JSON.stringify(changelog, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  console.log(`已生成 changelogs/v${version}.json，请填写 content 后执行 bun run changelog:sync`);
}

async function syncChangelogs() {
  const packageJson = await readJson(packageFile);
  const version = packageJson.version;
  validateVersion(version);

  const fileName = `v${version}.json`;
  const changelog = await readJson(path.join(changelogDirectory, fileName));
  if (!Array.isArray(changelog.releases) || changelog.releases.length !== 1) {
    throw new Error(`${fileName} 必须且只能包含一条 releases 记录`);
  }

  const release = changelog.releases[0];
  if (release.version !== version) {
    throw new Error(`${fileName} 的 version 必须是 ${version}`);
  }
  if (!Array.isArray(release.content) || release.content.length === 0) {
    throw new Error(`${fileName} 的 content 至少需要填写一条更新内容`);
  }
  validateReleaseHashes(release, fileName);

  // 总清单保留历史版本，只新增或更新 package.json 指定的当前版本。
  const manifestFile = path.join(changelogDirectory, "version.json");
  const manifest = await readJson(manifestFile);
  if (!Array.isArray(manifest.releases)) {
    throw new Error("changelogs/version.json 缺少 releases 数组");
  }

  const releases = manifest.releases.filter(
    (historyRelease) => historyRelease.version !== version,
  );
  releases.push(release);

  releases.sort((left, right) => compareVersions(left.version, right.version));
  await writeJson(manifestFile, {
    latest: releases[0].version,
    releases,
  });

  console.log(`已更新 changelogs/version.json，最新版本为 ${releases[0].version}`);
}

async function fillReleaseHashes() {
  const artifactsDirectory = process.argv[3];
  if (!artifactsDirectory) throw new Error("hashes 命令需要提供安装包目录");

  const packageJson = await readJson(packageFile);
  const version = packageJson.version;
  validateVersion(version);
  const fileName = `v${version}.json`;
  const changelogFile = path.join(changelogDirectory, fileName);
  const changelog = await readJson(changelogFile);
  if (!Array.isArray(changelog.releases) || changelog.releases.length !== 1) {
    throw new Error(`${fileName} 必须且只能包含一条 releases 记录`);
  }

  const release = changelog.releases[0];
  for (const releasePackage of getReleasePackages(release)) {
    if (!releasePackage.filename || !releasePackage.url) continue;
    const artifactPath = path.resolve(artifactsDirectory, releasePackage.filename);
    releasePackage.sha256 = await calculateFileSha256(artifactPath);
  }

  await writeJson(changelogFile, changelog);
  await syncChangelogs();
  console.log(`已写入 ${fileName} 的安装包 SHA-256`);
}

const command = process.argv[2];
try {
  if (command === "new") {
    await createChangelog();
  } else if (command === "sync") {
    await syncChangelogs();
  } else if (command === "hashes") {
    await fillReleaseHashes();
  } else {
    throw new Error("请使用 new、sync 或 hashes 命令");
  }
} catch (error) {
  if (error?.code === "EEXIST") {
    console.error("生成失败：当前版本文件已经存在，不会覆盖原有内容");
  } else {
    console.error(`执行失败：${error.message}`);
  }
  process.exitCode = 1;
}
