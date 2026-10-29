<div align="center">
  <img src="docs/images/readme-banner.svg" alt="XMD — local-first Markdown editor" width="100%" />
</div>

<div align="center">

<h1>XMD</h1>

**A local-first Markdown editor with WYSIWYG, source mode, and an AI sidekick.**

English · [简体中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/mr-dadong/x-markdown?style=for-the-badge&label=release&color=e8801f)](https://github.com/mr-dadong/x-markdown/releases)
[![License](https://img.shields.io/github/license/mr-dadong/x-markdown?style=for-the-badge&color=3da639)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2b2b2b?style=for-the-badge)](https://www.x-markdown.com/download)
[![Downloads](https://img.shields.io/github/downloads/mr-dadong/x-markdown/total?style=for-the-badge&color=4477dd)](https://github.com/mr-dadong/x-markdown/releases)

[![Stars](https://img.shields.io/github/stars/mr-dadong/x-markdown?style=for-the-badge&color=e8801f&logo=github)](https://github.com/mr-dadong/x-markdown/stargazers)
[![Website](https://img.shields.io/badge/website-x--markdown.com-black?style=for-the-badge&logo=googlechrome&logoColor=white)](https://www.x-markdown.com)

[**Download**](https://www.x-markdown.com/download) · [**Website**](https://www.x-markdown.com) · [**Changelog**](https://www.x-markdown.com/changelog) · [**Releases**](https://github.com/mr-dadong/x-markdown/releases)

</div>

---

## Why XMD

- **Local-first, no account.** Your documents stay on disk; nothing is uploaded unless you explicitly use an AI feature with your own model provider.
- **Two editors, one document.** Write in WYSIWYG or drop into source mode; every tab remembers its own mode and reading position.
- **Markdown that behaves.** Standard Markdown plus tables, task lists, math, Mermaid, callouts, footnotes, a live table of contents, and block-level HTML that round-trips faithfully.
- **Bring your own AI.** Chat with the document or let the Document Agent propose line-by-line edits for review — with your own API key, or fully offline without it.

<br />

## Highlights

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>✍️ WYSIWYG + Source</h3>
      Rich text and raw Markdown, one keystroke apart. Per-tab mode and reading position.
    </td>
    <td width="50%" valign="top">
      <h3>🗂️ Multi-tab Workspace</h3>
      Tabs, recent files, folder workspaces, lazy file tree, and automatic refresh on external changes.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Outline & Typography</h3>
      Live outline, line and character counts, themes, body fonts, line width, preview zoom, and code block styles.
    </td>
    <td width="50%" valign="top">
      <h3>🧩 Extended Markdown</h3>
      TOC, Mermaid diagrams, KaTeX math, callouts, footnotes, HTML blocks, tables, task lists, and attachments.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🤖 AI Chat + Document Agent</h3>
      Ask questions about the document, generate content inline, or review the Agent's proposed diffs before applying them.
    </td>
    <td width="50%" valign="top">
      <h3>📤 Complete Export</h3>
      HTML, PDF, Word (DOCX), PNG, plain text, and ZIP with local assets packed in. PDF supports headers, footers, and page breaks.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🗜️ Edit ZIP Archives</h3>
      Open a .zip workspace directly and save changes back to the archive, with clear errors when something goes wrong.
    </td>
    <td width="50%" valign="top">
      <h3>🛡️ Safe by Default</h3>
      Atomic writes, external-change detection, recoverable drafts, and file access limited to authorized paths.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🌍 Bilingual UI</h3>
      Simplified Chinese and English, following the system language and switchable in settings.
    </td>
    <td width="50%" valign="top">
      <h3>🖥️ Cross-platform</h3>
      Windows, macOS, and Linux AppImage packages, with file associations and in-app update checks.
    </td>
  </tr>
</table>

<details>
<summary><b>📋 Full feature list</b></summary>

- WYSIWYG and Markdown source modes; each tab remembers its editing mode
- Multi-tab documents: create, batch open, save, save as, and reorder tabs
- Recent files on the welcome screen and in the File menu; stale entries are cleaned up automatically
- Standalone folder workspaces with lazy directory expansion and automatic refresh
- Document outline with filtering, line/word/character counts, light and dark themes
- Tables, task lists, syntax highlighting, links, images, video, and attachments
- Tables of contents, Mermaid diagrams, KaTeX math, callouts, footnotes, and isolated HTML blocks
- AI Chat with document context, inline AI writing, and a reviewing Document Agent
- Export to HTML, PDF, DOCX, PNG, plain text, and ZIP (with local images, attachments, and video)
- PDF export with paper size, margins, custom headers and footers, and page breaks
- Open .zip archives directly and write changes back to the archive
- Safety nets: atomic writes, disk conflict detection, and recoverable drafts
- Configurable auto save after you stop typing; unnamed documents still need a manual save
- Code block line numbers, wrapping, language picker, copy, and PNG export
- Block selection, drag-to-reorder blocks, and a table toolbar
- File associations: double-click .md / .markdown / .txt to open with XMD; Windows context menu entry "Open with XMD"
- Simplified Chinese and English UI that follows the system language

</details>

---

## Screenshots

> Screenshots show the Chinese UI. The app ships with an English UI as well.

<table>
  <tr>
    <td width="50%">
      <img src="docs/images/workspace-outline.jpg" alt="Workspace and outline" width="100%" />
      <br /><sub><b>Workspace + outline</b> — file tree, live outline, and code blocks.</sub>
    </td>
    <td width="50%">
      <img src="docs/images/markdown-preview.jpg" alt="Markdown preview" width="100%" />
      <br /><sub><b>Markdown preview</b> — syntax highlighting and faithful rendering.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/images/general-settings.jpg" alt="General settings" width="100%" />
      <br /><sub><b>Settings</b> — language, themes, typography, export, shortcuts, and AI.</sub>
    </td>
    <td width="50%">
      <img src="docs/images/image-preview.jpg" alt="Image preview" width="100%" />
      <br /><sub><b>Image preview</b> — zoom, pan, fit width, and open with the system viewer.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/images/attachments-and-video.jpg" alt="Attachments and video" width="100%" />
      <br /><sub><b>Attachments and video</b> — cards, progress, and inline playback.</sub>
    </td>
    <td width="50%">
      <img src="docs/images/welcome-screen.jpg" alt="Welcome screen" width="100%" />
      <br /><sub><b>Welcome screen</b> — start a new document or jump back into a recent one.</sub>
    </td>
  </tr>
</table>

---

## Quick Start

<div align="center">

[![Download](https://img.shields.io/badge/Download_for-Windows%20%7C%20macOS%20%7C%20Linux-e8801f?style=for-the-badge&logo=github&logoColor=white)](https://www.x-markdown.com/download)

</div>

- **Windows 10/11** — download the `.exe` installer and follow the wizard.
- **macOS 12+** — Apple Silicon: `XMD-<version>-macOS-arm64.dmg`; Intel: `XMD-<version>-macOS-x64.dmg`.
- **Linux x86_64 / arm64** — download the AppImage, `chmod +x`, and run.

<details>
<summary><b>Installation notes (Gatekeeper, FUSE, desktop integration)</b></summary>

### macOS

1. Open the DMG and drag XMD into the Applications folder.
2. The first launch is blocked by Gatekeeper because the package is not code-signed. Control-click XMD in Applications, choose **Open**, and confirm. If there is no **Open** item, go to **System Settings → Privacy & Security** and click **Open Anyway**.
3. A “XMD is damaged” message means the app has a quarantine attribute. Remove it and reopen:

   ```bash
   xattr -dr com.apple.quarantine /Applications/XMD.app
   ```

### Linux

1. Make the AppImage executable and run it:

   ```bash
   chmod +x XMD-<version>-Linux-x86_64.AppImage
   ./XMD-<version>-Linux-x86_64.AppImage
   ```

2. If FUSE is missing (Ubuntu 22.04+ does not ship libfuse2 by default), install it or use the FUSE-free mode:

   ```bash
   sudo apt install libfuse2
   ./XMD-<version>-Linux-x86_64.AppImage --appimage-extract-and-run
   ```

3. For a menu icon and `.md` file associations, move the AppImage to a stable directory such as `~/.local/bin`, then use AppImageLauncher for desktop integration.

</details>

---

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New document |
| `Ctrl+O` | Open one or more documents |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+B` | Show or hide the sidebar |
| `Ctrl+,` | Open settings |

Shortcuts are customizable in **Settings → Shortcuts** and sync with the native menu accelerators.

---

## Tech Stack

![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)
![TipTap](https://img.shields.io/badge/TipTap-3-1a1a1a?style=flat-square)
![Bun](https://img.shields.io/badge/Bun-1.3.14-fbf0df?style=flat-square&logo=bun&logoColor=black)

## Development

The project uses Bun 1.3.14, matching CI.

```bash
bun install --frozen-lockfile
bun run dev
```

Common checks:

```bash
bun run typecheck                        # renderer
bunx tsc --noEmit -p tsconfig.node.json  # main process + preload
bun run lint
bun test ./src
bun run build
```

## Build & Release

```bash
bun run dist:win
bun run dist:mac
bun run dist:linux
```

Artifacts are written to `release/` (NSIS, DMG, and AppImage). Packages are not code-signed, so the OS may show an unknown publisher warning.

Pushing a `v*` tag triggers `.github/workflows/build.yml`, which builds all three platforms, creates a GitHub and CNB release, writes installer hashes, and syncs the update manifests. The version in `package.json` must match the tag before releasing:

```bash
git tag v1.3.12
git push origin v1.3.12
```

## Code Signing Policy

Free code signing is provided by [SignPath.io](https://signpath.io/), with a certificate issued by the [SignPath Foundation](https://signpath.org/).

- Committer and reviewer: [mr-dadong](https://github.com/mr-dadong)
- Approver: [mr-dadong](https://github.com/mr-dadong)
- Full policy: [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)
- Privacy policy: [PRIVACY.md](PRIVACY.md)

## Directory Layout

```text
electron/   Electron main process, preload, IPC, and path permissions
src/        Vue UI, editor extensions, composable state, and services
functions/  Cloudflare Pages Functions
site/       Project website
build/      Installer resources
changelogs/ App update manifests and release notes
```

## License

[GNU General Public License v3.0](LICENSE)

<div align="center">

**If XMD makes your writing a little smoother, consider giving it a star.**

[![Star XMD](https://img.shields.io/github/stars/mr-dadong/x-markdown?style=for-the-badge&label=Star%20XMD&color=e8801f&logo=github)](https://github.com/mr-dadong/x-markdown/stargazers)

<sub>Built with coffee and far too many open tabs by <a href="https://github.com/mr-dadong">dadong</a>.</sub>

</div>
