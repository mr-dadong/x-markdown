.DEFAULT_GOAL := help

.PHONY: help install dev typecheck build preview site deploy changelog-new changelog-sync manifest-upload dist-all dist-win dist-mac dist-mac-x64 dist-mac-arm64 dist-linux dist-linux-x64 dist-linux-arm64

# 展示项目中常用的开发和打包命令。
help:
	@echo 可用命令：
	@echo   make install    安装项目依赖
	@echo   make dev        启动 Electron 开发环境
	@echo   make typecheck  检查前端与 Electron 主进程类型
	@echo   make build      执行类型检查并生成生产构建
	@echo   make preview    预览生产构建
	@echo   make site       在本地启动网站开发服务
	@echo   make deploy     部署网站到 xmd-site 项目
	@echo   make changelog-new   按 package.json 版本生成更新记录模板
	@echo   make changelog-sync  汇总版本记录并更新 version.json
	@echo   make manifest-upload 将 version.json 上传到 Cloudflare KV
	@echo   make dist-all   依次生成 Windows、macOS 双架构和 Linux 双架构安装包
	@echo   make dist-win   生成 Windows 安装包
	@echo   make dist-mac         生成 macOS x64 和 arm64 DMG 安装包（需要在 macOS 执行）
	@echo   make dist-mac-x64     生成 macOS Intel x64 DMG 安装包（需要在 macOS 执行）
	@echo   make dist-mac-arm64   生成 macOS Apple Silicon arm64 DMG 安装包（需要在 macOS 执行）
	@echo   make dist-linux       生成 Linux x64 和 arm64 AppImage 安装包
	@echo   make dist-linux-x64   生成 Linux AMD/Intel x64 AppImage 安装包
	@echo   make dist-linux-arm64 生成 Linux arm64 AppImage 安装包

# 使用锁文件中记录的版本安装依赖。
install:
	bun install --frozen-lockfile

dev:
	bun run dev

typecheck:
	bun run typecheck
	bunx tsc --noEmit -p tsconfig.node.json

build: typecheck
	bun run build

preview:
	bun run preview

# 使用 site 目录中的静态文件启动 Cloudflare Pages 本地开发服务。
site:
	npx wrangler pages dev site

# 将 site 目录部署到 Cloudflare Pages 的 xmd-site 项目。
deploy:
	npx wrangler pages deploy site --project-name xmd-site

# 新版本模板只需要手动填写 content 数组。
changelog-new:
	bun run changelog:new

# 填写完版本内容后，重新生成供客户端和网站读取的总清单。
changelog-sync:
	bun run changelog:sync

# 把本地生成的版本清单上传到 Cloudflare KV：manifest 只含最新版，history 存全量历史。
# wrangler 4 默认写入本地模拟环境，必须加 --remote 才会真正上传到线上 KV。
manifest-upload:
	npx wrangler kv key put manifest --path changelogs/latest.json --binding VERSION_MANIFEST --remote
	npx wrangler kv key put history --path changelogs/version.json --binding VERSION_MANIFEST --remote

# 依次打包所有平台；执行环境需要具备各平台对应的打包及签名工具。
dist-all: dist-win dist-mac dist-linux

# 安装包会输出到 release 目录，并注册传统 Windows 右键菜单。
dist-win: typecheck
	bun run dist:win

# macOS 应用签名及 DMG 工具依赖 macOS，因此以下命令需要在 Mac 上执行。
dist-mac: typecheck
	bun run dist:mac

dist-mac-x64: typecheck
	bun run dist:mac:x64

dist-mac-arm64: typecheck
	bun run dist:mac:arm64

# 生成可直接运行的 Linux AppImage，以下产物均输出到 release 目录。
dist-linux: typecheck
	bun run dist:linux

dist-linux-x64: typecheck
	bun run dist:linux:x64

dist-linux-arm64: typecheck
	bun run dist:linux:arm64
