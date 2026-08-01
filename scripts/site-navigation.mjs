import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const siteDirectory = path.join(projectDirectory, "site");
const navigationStart = "<!-- 公共导航开始";
const navigationEnd = "<!-- 公共导航结束 -->";

const pages = [
  { file: "index.html", activeHref: "/", downloadHref: "/download" },
  { file: "features.html", activeHref: "/features", downloadHref: "/download" },
  { file: "download.html", activeHref: "/download", downloadHref: "#platforms" },
  { file: "changelog.html", activeHref: "/changelog", downloadHref: "/download" },
];

function findNavigationRange(html, fileName) {
  const start = html.indexOf(navigationStart);
  const end = html.indexOf(navigationEnd, start);

  if (start === -1 || end === -1) {
    throw new Error(`${fileName} 缺少公共导航标记`);
  }

  return { start, end: end + navigationEnd.length };
}

function createPageNavigation(sourceNavigation, page) {
  // 先清除模板中的首页高亮，再根据目标页面设置唯一的当前项。
  let navigation = sourceNavigation.replaceAll("nav__link is-active", "nav__link");
  const activeLink = `href="${page.activeHref}" class="nav__link"`;

  if (!navigation.includes(activeLink)) {
    throw new Error(`${page.file} 的当前导航地址不存在：${page.activeHref}`);
  }

  navigation = navigation.replace(activeLink, `${activeLink.slice(0, -1)} is-active"`);

  // 下载页按钮跳到安装包列表，其他页面则进入下载页。
  navigation = navigation.replace(
    /href="(?:\/download|#platforms)" class="nav__cta"/,
    `href="${page.downloadHref}" class="nav__cta"`,
  );

  const markerText = page.file === "index.html"
    ? "<!-- 公共导航开始：修改后运行 bun run site:sync-nav 同步到其他页面。 -->"
    : "<!-- 公共导航开始：此区域由 bun run site:sync-nav 自动同步。 -->";

  return navigation.replace(/^<!-- 公共导航开始[^\n]*-->/, markerText);
}

const sourcePath = path.join(siteDirectory, "index.html");
const sourceHtml = await readFile(sourcePath, "utf8");
const sourceRange = findNavigationRange(sourceHtml, "index.html");
const sourceNavigation = sourceHtml.slice(sourceRange.start, sourceRange.end);

for (const page of pages) {
  const pagePath = path.join(siteDirectory, page.file);
  const html = await readFile(pagePath, "utf8");
  const range = findNavigationRange(html, page.file);
  const navigation = createPageNavigation(sourceNavigation, page);
  const updatedHtml = html.slice(0, range.start) + navigation + html.slice(range.end);

  await writeFile(pagePath, updatedHtml, "utf8");
  console.log(`已同步 ${page.file}`);
}
