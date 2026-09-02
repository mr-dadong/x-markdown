# XMD 官网目录说明

该目录保存 XMD 官网的静态页面和 Cloudflare Pages 配置。网站不依赖前端
框架，也不需要执行 Electron 项目的构建命令。

## 目录结构

```text
site/
├─ assets/
│  ├─ css/style.css       # 全站公共样式
│  └─ js/
│     ├─ main.js          # 导航栏和页面通用交互
│     └─ releases.js      # 版本信息、下载按钮和更新日志
├─ index.html             # 首页
├─ features.html          # 功能介绍
├─ download.html          # 下载页面
├─ changelog.html         # 更新日志
├─ favicon.png            # 网站图标
├─ _headers               # Cloudflare Pages 响应头和缓存规则
└─ _routes.json           # 将 /api/* 交给 Pages Function
```

## 版本信息和软件下载

页面中的 `assets/js/releases.js` 请求同源接口：首页和下载页读取
`/api/version`（只含最新版的小清单），changelog 页读取 `/api/history`
（全量历史）。

该接口由仓库根目录的 `functions/api/version.js` 和 `functions/api/history.js`
提供。两个接口分别读取 Cloudflare KV 中的 `manifest` 和 `history` key，
首次配置方法见仓库根目录 `CLOUDFLARE.md` 的“版本清单 KV 存储”章节。

安装包不会经过 Cloudflare 代理。页面会读取版本清单中的下载地址，让用户
直接前往 CNB 下载。

## 本地预览

需要同时预览静态页面和 `/api/version` 接口时，在仓库根目录运行：

```powershell
npx wrangler pages dev site
```

不要直接双击打开 HTML 文件，因为本地文件环境没有 `/api/version` 接口，
版本号、更新日志和下载按钮将无法加载。

## 部署到 Cloudflare Pages

使用 Wrangler 部署：

```powershell
npx wrangler pages deploy site --project-name xmd-site
```

也可以在 Cloudflare Workers & Pages 中连接 Git 仓库，并设置：

- Framework preset：`None`
- Build command：`exit 0`
- Build output directory：`site`
- Root directory：仓库根目录

项目包含 Pages Functions，因此不能使用控制台拖放目录的方式部署。

## 修改约定

- 新增公共样式时统一写入 `assets/css/style.css`。
- 新增通用交互时写入 `assets/js/main.js`。
- 公共导航统一在 `index.html` 的“公共导航”区域维护，修改后运行
  `bun run site:sync-nav`，不要分别修改其他页面的导航。
- 版本、发布日期、更新内容和安装包地址统一维护在仓库的
  `changelogs/v*.json`，运行 `make changelog-sync` 会同步生成小清单
  `latest.json` 和全量历史 `version.json`，发布时由 CI 自动上传到
  Cloudflare KV，不要在 HTML 中重复维护。
- 新增依赖 Pages Function 的接口时，需要同步调整 `_routes.json`。
