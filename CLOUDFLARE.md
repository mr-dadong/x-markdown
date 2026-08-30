# 将 XMD 官网部署到 Cloudflare

`site` 目录是一个无需构建的静态多页网站。官网通过 Pages Function
读取 CNB 上的版本清单，因此部署到 Cloudflare Pages。

## 部署到 Pages

### 通过 Cloudflare 控制台连接 Git 仓库

在 Workers & Pages 中创建 Pages 项目，并设置：

- Framework preset：`None`
- Build command：`exit 0`
- Build output directory：`site`
- Root directory：仓库根目录（留空即可）

### 使用命令行直接上传

```powershell
npx wrangler pages deploy site --project-name xmd-site
```

也可以在仓库根目录运行 `make deploy`，效果相同。

本地预览运行 `make site`（等价于 `npx wrangler pages dev site`）。

`site/_headers` 会在 Pages 部署时添加基本安全响应头和静态资源缓存规则。
`functions/api/version.js` 会生成 `/api/version` 接口，在 Cloudflare 服务端
读取 CNB 的版本清单，从而避开浏览器的跨域限制。`site/_routes.json` 将
Function 调用范围限制在 `/api/*`，普通静态页面不会调用 Function。

包含 Functions 的项目不能通过 Cloudflare 控制台拖放文件部署，请使用
Git 仓库集成或上面的 Wrangler 命令部署。

## 路由说明

Cloudflare 会把 `features.html` 等页面提供为 `/features` 形式的简洁地址。
现有页面中的 `features.html`、`download.html` 等相对链接仍然可以正常工作，
因此无需批量改写 HTML。
