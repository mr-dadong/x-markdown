import { readFile, writeFile } from "node:fs/promises";
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
        },
        {
          arch: "x64",
          format: "dmg",
          installer: "DMG",
          filename: `XMD-${version}-macOS-x64.dmg`,
          url: `${releaseUrl}/XMD-${version}-macOS-x64.dmg`,
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
        },
        {
          arch: "arm64",
          format: "AppImage",
          installer: "AppImage",
          filename: `XMD-${version}-Linux-arm64.AppImage`,
          url: `${releaseUrl}/XMD-${version}-Linux-arm64.AppImage`,
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

const command = process.argv[2];
try {
  if (command === "new") {
    await createChangelog();
  } else if (command === "sync") {
    await syncChangelogs();
  } else {
    throw new Error("请使用 new 或 sync 命令");
  }
} catch (error) {
  if (error?.code === "EEXIST") {
    console.error("生成失败：当前版本文件已经存在，不会覆盖原有内容");
  } else {
    console.error(`执行失败：${error.message}`);
  }
  process.exitCode = 1;
}
