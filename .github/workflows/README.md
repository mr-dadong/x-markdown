# XMD 多平台安装包工作流使用说明

本文档介绍如何使用 [`build.yml`](./build.yml) 在 GitHub Actions 中构建 XMD 的 Windows、macOS 和 Linux 安装包。

## 一、工作流会生成什么

每次运行工作流都会同时启动三个相互独立的构建任务：

| 构建任务 | 云端系统 | 生成产物 |
| --- | --- | --- |
| Windows | `windows-latest` | Windows x64 `.exe` |
| macOS | `macos-15-intel` | macOS x64 和 arm64 `.dmg` |
| Linux | `ubuntu-latest` | Linux x64 和 arm64 `.AppImage` |

三个任务并行运行。某个平台构建失败不会取消其他已经开始的任务，但只有成功任务的产物可以下载。
推送版本标签触发构建时，三个任务全部成功后还会自动创建 GitHub Release，并上传所有安装包。

## 二、首次使用前的准备

### 1. 创建 GitHub 仓库

登录 GitHub，打开 <https://github.com/new> 创建一个空仓库。

创建时不要勾选以下选项，避免与本地仓库产生提交冲突：

- Add a README file
- Add `.gitignore`
- Choose a license

公开仓库使用标准 GitHub Actions Runner 时不收取构建分钟费用，但仓库代码会被所有人看到。私有仓库不会公开代码，但会使用账户的 Actions 免费额度。

### 2. 将本地仓库连接到 GitHub

本项目原有的 `origin` 可以继续指向 CNB，另外添加一个名为 `github` 的远程仓库：

```powershell
git remote add github https://github.com/你的用户名/xmd.git
git remote -v
```

远程地址中不要直接写访问令牌或密码。GitHub 要求登录时，可以使用浏览器授权、GitHub CLI 或 Git Credential Manager。

### 3. 提交工作流文件

只添加需要提交的源文件，不要把 `release`、`out` 或本地生成的安装包一起提交：

```powershell
git add .github/workflows/build.yml .github/workflows/README.md tsconfig.node.json
git commit -m "添加多平台安装包构建工作流"
git push -u github main
```

本项目当前分支为 `main`。后续提交可以继续使用：

```powershell
git push github main
```

## 三、手动运行工作流

1. 打开 GitHub 上的 `xmd` 仓库。
2. 点击仓库顶部的 **Actions**。
3. 在左侧选择 **构建多平台安装包**。
4. 点击右侧的 **Run workflow**。
5. 确认分支为 `main`，再次点击绿色的 **Run workflow**。
6. 等待新的运行记录出现，然后点击该记录查看进度。

页面中会显示以下三个任务：

- 构建 Windows x64
- 构建 macOS x64 和 arm64
- 构建 Linux x64 和 arm64

绿色对勾表示成功，红色叉号表示失败。点击任务名称可以查看每一个命令的完整日志。

## 四、下载构建产物

三个任务完成后：

1. 打开本次工作流的运行详情页面。
2. 滚动到页面底部的 **Artifacts** 区域。
3. 根据需要下载以下产物：

| Artifacts 名称 | 内容 |
| --- | --- |
| `XMD-Windows-x64` | Windows x64 安装程序 |
| `XMD-macOS` | Intel 和 Apple Silicon 两种 DMG |
| `XMD-Linux` | x64 和 arm64 两种 AppImage |

GitHub 会在下载时额外包装一层 ZIP。先解压 ZIP，再获得其中真正的 `.exe`、`.dmg` 或 `.AppImage` 文件。

## 五、使用版本标签自动构建

除了手动运行，`build.yml` 还会在推送以 `v` 开头的 Git 标签时自动构建。

发布新版本前，先修改 `package.json` 中的 `version`，例如：

```json
{
  "version": "1.1.0"
}
```

提交版本修改后创建并推送同名标签：

```powershell
git add package.json
git commit -m "发布 1.1.0"
git tag v1.1.0
git push github main
git push github v1.1.0
```

推送标签后，GitHub Actions 会自动运行。三个平台全部构建成功后，工作流会创建对应的
GitHub Release、自动生成发行说明，并上传 `.exe`、`.dmg` 和 `.AppImage` 文件。

安装包文件名中的版本取自 `package.json`，不会自动从 Git 标签读取，因此两处版本应保持一致。
手动点击 **Run workflow** 只生成 Actions Artifacts，不会创建 Release。

## 六、关于签名和系统安全提示

当前工作流没有配置 Windows 或 macOS 代码签名证书：

- Windows 可能显示“未知发布者”或 SmartScreen 提示。
- macOS 可能提示应用来自身份不明的开发者。
- Linux AppImage 首次运行前可能需要增加可执行权限。

未签名不代表构建失败，但不适合直接用于要求可信发布者的正式商业分发。正式发布时需要分别配置 Windows 代码签名证书和 Apple Developer 证书。

## 七、常见问题

### Actions 页面中看不到工作流

确认以下条件：

- `build.yml` 已经推送到 GitHub，而不只是保存在本地。
- 文件路径是 `.github/workflows/build.yml`。
- 当前查看的是包含该文件的默认分支。
- 仓库的 **Settings → Actions → General** 没有禁用 Actions。

### `Run workflow` 按钮没有显示

`workflow_dispatch` 只有在工作流文件存在于默认分支时才会显示。先将包含 `build.yml` 的 `main` 分支推送到 GitHub。

### 依赖安装失败

工作流使用：

```bash
bun install --frozen-lockfile
```

因此 `package.json` 与 `bun.lock` 必须保持一致。修改依赖后，应在本地执行 `bun install` 并同时提交更新后的 `bun.lock`。

### 类型检查失败

在本地先运行：

```powershell
make typecheck
```

修复本地错误并推送后，再重新运行工作流。重新运行失败任务仍会消耗私有仓库的 Actions 额度。

### 构建时访问 GitHub 超时

云端网络也可能出现临时下载失败。可以进入失败的运行记录，点击右上角的 **Re-run jobs → Re-run failed jobs**，只重新运行失败任务。

### macOS 安装包无法直接打开

当前 DMG 没有 Apple Developer 签名和公证。测试用户需要在 macOS 的系统安全设置中确认打开，正式公开分发则应配置签名和公证。

## 八、建议的发布流程

每次准备发布时按以下顺序操作：

1. 在本地完成开发和测试。
2. 更新 `package.json` 中的版本号。
3. 执行 `make typecheck`。
4. 提交代码并推送到 GitHub。
5. 创建并推送对应的 `v版本号` 标签。
6. 在 Actions 页面确认三个平台全部构建成功。
7. 打开自动创建的 GitHub Release，下载并分别测试安装包。
8. 确认安装包可用后，将该 Release 发布地址提供给用户。
