.DEFAULT_GOAL := help

.PHONY: help install dev typecheck build preview dist-all dist-win dist-mac dist-mac-x64 dist-mac-arm64 dist-linux dist-linux-x64 dist-linux-arm64

# 展示项目中常用的开发和打包命令。
help:
	@echo 可用命令：
	@echo   make install    安装项目依赖
	@echo   make dev        启动 Electron 开发环境
	@echo   make typecheck  检查前端与 Electron 主进程类型
	@echo   make build      执行类型检查并生成生产构建
	@echo   make preview    预览生产构建
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
