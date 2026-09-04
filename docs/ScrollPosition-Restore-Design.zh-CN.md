# 多标签页滚动位置记忆 设计方案

> 目标版本: XMD 1.2.7+
> 状态: 待评审
> 关联模块: `EditorView.vue` / `useDocument.ts` / `MarkdownEditor.vue` / `MarkdownSourceEditor.vue` / `useEditor.ts` / `viewSync.ts`

## 1. 问题背景

在多标签页场景下,用户在**超长文档 A** 中滚动到中部阅读,随后切换到**文档 B**,再切回文档 A 时,视图区域回到了文档顶部(或残留上一次切换前的无效滚动值),用户必须重新向下滚动才能回到原来的阅读位置。文档越长、切换越频繁,体验损耗越大。

### 1.1 现状代码路径

当前标签切换的完整链路:

```
点击标签 → DocumentBar emit('activate') → useDocument.activateDocument(id)
  → activeDocumentId 变化
    → currentContent / currentFilePath 变化
      → MarkdownEditor 的 watch([getContent, getIsActive, path]) 触发
        → editor.commands.setContent(newContent, false)   ← 内容整体替换
      → MarkdownSourceEditor 的 watch(content) 触发
        → editor.dispatch({ changes: { from: 0, to: len, insert } })  ← 内容整体替换
```

关键事实:

- `MarkdownEditor` 与 `MarkdownSourceEditor` 都是**单实例常驻**(`v-if="isDocumentOpen"` 挂载一次),切换标签不销毁重建,只是内容被整体替换。
- `OpenDocument` 数据结构(`src/types/index.ts`)只保存 `id / filePath / content / savedContent / modifiedTime / isModified`,**没有保存每个文档的视图状态**。
- 项目里已经存在一套「视图锚点」基础设施,但**只用于渲染 ↔ 源码模式切换**(`toggleSourceMode`):
  - 渲染视图:`getViewportAnchor()` 返回 `{ index, fraction }`(顶层块序号 + 视口切入块内深度比例),`scrollToBlockFraction()` 恢复。
  - 源码视图:`getViewportSourceLine()` / `scrollToSourceLine()`。
  - `viewSync.ts` 提供渲染视图顶层块与源码行号的互相映射。
- 这套基础设施完全可以复用到标签切换场景,只是缺少「按文档保存/恢复」的容器。

## 2. 业界优秀设计参考

| 产品 | 做法 | 可借鉴点 |
|---|---|---|
| **VS Code** | 每个 editor tab 维护独立的 `ViewState`(滚动位置、光标、选区、折叠状态),切回标签时完整恢复,且跨会话持久化 | ① 视图状态按 tab 独立存储,与文档内容解耦;② 保存的是**语义锚点**而非裸像素值;③ 恢复发生在内容渲染完成之后 |
| **浏览器标签页** | 后台标签页 DOM 常驻,切回时滚动位置天然保留(`history.scrollRestoration` 处理前进/后退) | 切换不销毁视图是「零成本记忆」的底层思路,本项目单实例常驻与此一致,只需补上内容替换后的位置恢复 |
| **Typora / Obsidian** | 每个打开的文档标签记住自己的滚动位置,切回即还原 | 阅读类场景下「回到上次位置」是默认行为,不应要求用户手动操作 |
| **JetBrains IDE** | 每个文件记住光标与滚动位置,甚至记住每个文件最后一次编辑位置 | 位置恢复粒度可以细到「块内偏移比例」,比「回到标题」更精确 |
| **浏览器阅读器/PDF** | 记住阅读进度(百分比或页码) | 锚点应**对内容长度变化鲁棒**:内容变短时钳制到末尾,变长时仍落在合理位置 |

**共性结论:**

1. **状态按文档维度隔离**——每个标签页是独立的「视图状态单元」,切换是「保存旧视图 + 恢复新视图」,而不是「共享一个滚动容器」。
2. **锚点必须是语义的,不是像素的**——像素 `scrollTop` 在内容替换后必然失效;语义锚点(块序号 + 块内比例 / 源码行号)在内容变化时依然可换算、可钳制。
3. **恢复时机在布局稳定之后**——`setContent` 完成后要等 DOM 布局与首帧渲染结束再定位,否则锚点换算会落在过期的高度上。
4. **新打开的文档回到顶部**——只有「曾经看过」的文档才需要恢复,首次打开不应有跳转感。

## 3. 设计方案

### 3.1 总体思路

为每个打开的文档维护一份「视图状态」,在标签切换时:

```
用户点击标签 B
  │
  ├─ 1. 保存旧文档 A 的视图状态(渲染锚点 或 源码行号,取决于 A 当前所处模式)
  │
  ├─ 2. 切换 activeDocumentId → 内容替换(现有链路不变)
  │
  └─ 3. 恢复新文档 B 的视图状态:
         ├─ B 有历史状态 → 按 B 所处模式还原(渲染:块+比例 / 源码:行号)
         └─ B 无历史状态(新打开) → 保持顶部
```

### 3.2 数据模型

在 `useDocument.ts` 中扩展每个文档的视图状态(推荐放在 `useDocument` 的 `Map` 中,而非塞进 `OpenDocument` 内容字段,避免污染草稿序列化/保存逻辑):

```ts
// src/composables/useDocument.ts 内部(或独立模块)
interface DocumentViewState {
  /** 渲染模式(所见即所得)下的视口锚点:顶层块序号 + 块内偏移比例 */
  renderedAnchor: ViewportAnchor | null;
  /** 源码模式(CodeMirror)下的视口顶部行号(0 起始,可为小数) */
  sourceLine: number | null;
}

const documentViewStates = new Map<number, DocumentViewState>();
```

要点:

- **与编辑模式解耦**:`documentModes` 已经记录了每个文档当前的编辑模式(渲染/源码),恢复时按该文档自己的模式选择对应锚点字段,互不干扰。
- **不持久化到磁盘**:滚动位置属于会话级 UI 状态,不进入恢复草稿(`RecoveryDraftData`),避免草稿文件因频繁滚动而抖动。如需跨会话记忆可作后续增强(见 §5)。
- **关闭标签即清理**:文档关闭时删除对应 `Map` 条目,避免内存泄漏。

### 3.3 保存时机与方式

在 `EditorView.vue` 中监听 `activeDocumentId` 变化,在**切换发生前**(旧文档仍处于可见状态)捕获锚点:

```ts
watch(activeDocumentId, async (newId, oldId) => {
  // 1) 保存旧文档的视图状态(旧文档此刻仍在 DOM 中,锚点有效)
  if (oldId !== null) {
    const state: DocumentViewState = {
      renderedAnchor: isSourceMode.value
        ? null
        : editorRef.value?.getViewportAnchor() ?? null,
      sourceLine: isSourceMode.value
        ? sourceEditorRef.value?.getViewportSourceLine() ?? null
        : null,
    };
    documentViewStates.set(oldId, state);
  }
  // 2) ... 原有模式恢复逻辑(documentModes) ...
  // 3) 恢复新文档视图状态(见 3.4)
});
```

注意:

- **直接复用现有锚点函数**,它们已经处理了「滚动越过末尾落到留白区」等边界(`getViewportAnchor` 返回最后一个块底部)。
- 保存的是**语义锚点**,因此切走期间即使文档内容在后台变化(自动保存、外部更新),切回时仍能按块/行定位,只是块序号可能漂移——`scrollToBlockFraction` 与 `scrollToSourceLine` 内部已有钳制逻辑兜底。

### 3.4 恢复时机与方式

恢复必须发生在**内容替换完成、布局稳定之后**。沿用 `toggleSourceMode` 已验证的时序模式:`nextTick()` + 下一帧:

```ts
// 在 activeDocumentId watch 内,切换完成后:
await nextTick();
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const state = documentViewStates.get(newId);
if (!state) return; // 新打开或无历史 → 保持顶部

if (isSourceMode.value) {
  if (state.sourceLine !== null) {
    sourceEditorRef.value?.scrollToSourceLine(state.sourceLine);
  }
} else if (state.renderedAnchor !== null) {
  editorRef.value?.scrollToBlockFraction(
    state.renderedAnchor.index,
    state.renderedAnchor.fraction,
  );
}
```

要点:

- **两阶段等待**:`nextTick` 保证 Vue 已完成 DOM 更新(内容替换、`v-show` 显隐切换);`requestAnimationFrame` 保证浏览器已对首帧完成布局,锚点换算基于真实高度。
- **源码视图用 `scrollToSourceLine` 而非直接写 `scrollTop`**:CodeMirror 刚切换显示时直接写 `scrollTop` 会落在过期的高度估算上,项目注释已明确此坑,复用现有方法即可。
- **查找替换的跨标签跳转需要豁免**:`useFindReplace` 在跨标签查找时会调用 `activateDocument` 后立即 `scrollToMatch`。此时不应再恢复旧锚点覆盖查找定位。设计上提供「本次切换是否由查找驱动」的标记,查找驱动时跳过恢复(见 §3.6)。

### 3.5 修改点清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/composables/useDocument.ts` | 新增 `documentViewStates` Map 及 `getViewState / setViewState / clearViewState` 小工具 | 状态容器,生命周期随文档 |
| `src/views/EditorView.vue` | 改造 `watch(activeDocumentId)`:切换前保存旧文档状态,切换后恢复新文档状态 | 核心逻辑落点 |
| `src/views/EditorView.vue` | 文档关闭时清理对应视图状态 | 可挂在现有 `closeDocument` 后的清理处,或 watch documents 数量变化时回收 |
| `src/composables/useFindReplace.ts` | 跨标签跳转时设置「跳过恢复」标记 | 避免查找定位被锚点恢复覆盖 |
| (可选) `src/types/editor.ts` | 导出 `DocumentViewState` 类型 | 供多个模块引用 |

### 3.6 与查找替换的联动

现状:`useFindReplace.goToNext` 在匹配位于其他标签时执行 `activateDocument(match.documentId)` 然后 `scrollToMatch(match)`。

冲突场景:查找驱动的切换如果触发了「恢复旧锚点」,会把视口拉到文档中部,随后查找的 `scrollToMatch` 又要跳到匹配处——出现两帧跳动,且最终位置不确定。

方案:

```ts
// useFindReplace:跨标签跳转前设置标记
skipViewStateRestoreForNextSwitch.value = true;
activateDocument(match.documentId);

// EditorView watch 内:
const shouldRestore = !skipViewStateRestoreForNextSwitch.value;
skipViewStateRestoreForNextSwitch.value = false;
if (shouldRestore) { /* 恢复锚点 */ }
```

### 3.7 边界情况

| 场景 | 行为 |
|---|---|
| 首次打开文档(无历史状态) | 不恢复,保持在顶部,无跳转感 |
| 文档内容在切走期间变短 | `scrollToBlockFraction` / `scrollToSourceLine` 内部钳制到末尾 |
| 空文档 | 锚点为 `null`,跳过恢复 |
| 文档在渲染模式保存锚点,切回时处于源码模式 | 按该文档的 `documentModes` 模式,恢复对应的 `sourceLine` 字段 |
| 标签被关闭后重新打开 | 状态已清理,视为首次打开 |
| 窗口隐藏期间切换 | `rAF` 在隐藏窗口不触发,恢复被跳过;切回窗口后不强制跳转(与 `useFindReplace` 现有处理一致,可接受) |
| 图片/视频异步加载撑高文档 | 首帧恢复可能略有偏差;可注册一次性的图片 `load` 校正(见 §5 增强) |

## 4. 验收标准

1. 打开两个超长文档 A、B,在 A 中滚动到中部 → 切到 B → 切回 A,视口回到**块内同一相对位置**(非块顶、非顶部)。
2. A 在渲染模式记忆位置,B 在源码模式记忆位置,各自切换往返均能还原。
3. 新打开文档始终从顶部开始,无跳转闪烁。
4. 跨标签查找(关键词在另一个文档)时,切过去后直接定位到匹配处,不被锚点恢复干扰。
5. 关闭标签后重新打开同一文件,从顶部开始(状态已清理)。
6. 内容变短(切走期间删除后半部分)后切回,滚动位置被钳制到新末尾,不报错、不闪跳。

## 5. 后续增强(可选)

1. **图片加载后的二次校正**:文档首次恢复时若包含未加载完成的图片,注册一次性 `load` 监听,布局稳定后微调一次 `scrollTop`。
2. **光标位置记忆**:除视口锚点外,再记录光标/选区位置(渲染:ProseMirror `pos`;源码:CodeMirror 字符偏移),切回时同时还原光标——与 VS Code 对齐。注意与视口锚点的优先级(光标优先,锚点兜底)。
3. **跨会话记忆**:将视图状态随草稿/最近文件持久化,重启后恢复上次阅读位置(需权衡草稿体积,可仅存锚点字段)。
4. **大纲高亮联动**:恢复位置后让侧边栏大纲高亮当前章节,增强「我在哪」的感知(项目已有 `scroll-to-heading` 反向能力,正向联动需补充)。
