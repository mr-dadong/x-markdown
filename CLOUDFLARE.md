# 将 XMD 官网部署到 Cloudflare

`site` 目录是一个无需构建的静态多页网站。官网通过 Pages Function 读取
Cloudflare KV 中的版本清单，因此部署到 Cloudflare Pages。

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
仓库提供两个 Pages Function：`/api/version` 返回只含最新版的小清单
（体积恒定，不随历史版本增长），`/api/history` 返回全量版本历史。
`site/_routes.json` 将 Function 调用范围限制在 `/api/*`，普通静态页面
不会调用 Function。

## 版本清单 KV 存储

版本清单统一保存在 Cloudflare KV 中：`manifest` key 存最新版小清单，
`history` key 存全量历史，官网和桌面客户端更新检测都读取这份数据。
首次配置步骤：

1. 运行 `npx wrangler login` 登录 Cloudflare 账号。
2. 运行 `npx wrangler kv namespace create VERSION_MANIFEST` 创建 KV
   命名空间，把输出中的 `id` 填入仓库根目录 `wrangler.toml` 对应位置。
3. 运行 `make manifest-upload`，把两份清单上传到 KV。
4. 运行 `make deploy` 部署网站，之后访问 `/api/version` 即可读到清单。

CI 会在每次发布时自动执行清单上传；本地仅首次配置需要手动运行
`make manifest-upload`。若要在 GitHub Actions 中自动化，需在仓库 Secrets
中配置 `CLOUDFLARE_API_TOKEN`（需目标 KV 命名空间的编辑权限）。

包含 Functions 的项目不能通过 Cloudflare 控制台拖放文件部署，请使用
Git 仓库集成或上面的 Wrangler 命令部署。

## 路由说明

Cloudflare 会把 `features.html` 等页面提供为 `/features` 形式的简洁地址。
现有页面中的 `features.html`、`download.html` 等相对链接仍然可以正常工作，
因此无需批量改写 HTML。
