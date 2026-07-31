# Bun 使用指南

本项目支持使用 [Bun](https://bun.sh/) 作为包管理器和运行时，提供更快的安装速度和运行性能。

## 安装 Bun

### Windows

```powershell
# 使用 PowerShell
irm bun.sh/install.ps1 | iex
```

### macOS/Linux

```bash
curl -fsSL https://bun.sh/install | bash
```

### 验证安装

```bash
bun --version
```

## 使用 Bun 运行项目

### 安装依赖

```bash
bun install
```

这会生成 `bun.lockb` 锁定文件，确保依赖版本一致性。

### 开发模式

```bash
bun run dev
```

或者使用快捷脚本：

```bash
bun run bun:dev
```

### 构建生产版本

```bash
bun run build
```

### 预览生产版本

```bash
bun run preview
```

## Bun 的优势

1. **更快的安装速度**：比 npm/yarn 快 10-100 倍
2. **更快的启动时间**：使用 JavaScriptCore 引擎，启动更快
3. **更低的内存占用**：优化的内存管理
4. **TypeScript 支持**：原生支持 TypeScript，无需编译
5. **内置打包器**：可替代 webpack/vite 进行打包

## 配置说明

### bunfig.toml

Bun 的配置文件，包含：

- 安装配置（缓存、并发数等）
- 运行时配置（内存限制等）
- 开发服务器配置（端口、热更新等）
- 构建配置（目标环境、压缩等）

### packageManager

在 `package.json` 中指定包管理器：

```json
{
  "packageManager": "bun@1.0.0"
}
```

## 常见问题

### Q: bun install 失败怎么办？

A: 尝试以下步骤：

1. 清除缓存：`bun pm cache rm`
2. 删除 `node_modules` 和 `bun.lockb`
3. 重新安装：`bun install`

### Q: 如何切换回 npm？

A: 直接使用 npm 命令即可，Bun 和 npm 可以共存：

```bash
npm install
npm run dev
```

### Q: Bun 支持 Electron 吗？

A: 是的，Bun 可以很好地与 Electron 配合使用。本项目使用 `electron-vite` 作为构建工具，它支持 Bun 作为包管理器。

### Q: 如何更新 Bun？

A: 运行以下命令：

```bash
bun upgrade
```

## 性能对比

| 操作 | npm | Bun | 提升 |
| --- | --- | --- | --- |
| 安装依赖 | 45s | 3s | 15x |
| 启动开发服务器 | 8s | 2s | 4x |
| 构建生产版本 | 25s | 8s | 3x |

*注：以上数据为示例，实际性能取决于项目大小和硬件配置*

## 更多资源

- [Bun 官方文档](https://bun.sh/docs)
- [Bun GitHub](https://github.com/oven-sh/bun)
- [Bun 与 Electron](https://bun.sh/docs/runtime/electron)