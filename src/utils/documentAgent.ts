import type { DocumentPatch } from '../types/documentAgent';

/** 把 \r\n 和旧式单独 \r 的换行统一为 \n，与 CodeMirror 文档文本的拆行规则一致，
 *  供编辑器回写比较时把磁盘原文和编辑器文本放到同一坐标系。 */
export function toLfLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

/** 写入前再次核对原文和范围；重复、重叠或过期修改一律报错。 */
export function applyDocumentPatches(document: string, patches: DocumentPatch[]): string {
  const sorted = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 0; index < sorted.length; index++) {
    const patch = sorted[index];
    if (!Number.isInteger(patch.start) || !Number.isInteger(patch.end) ||
      patch.start < 0 || patch.end < patch.start || patch.end > document.length) {
      throw new Error('修改位置无效，请重新读取文档');
    }
    if (document.slice(patch.start, patch.end) !== patch.before) {
      throw new Error('修改原文不匹配，请重新读取文档');
    }
    const previous = sorted[index - 1];
    if (previous && (previous.end > patch.start || previous.start === patch.start)) {
      throw new Error('修改范围重叠，请合并为一处修改');
    }
    if (patch.before === patch.after) throw new Error('修改前后内容相同');
  }
  // 所有坐标都属于原文，按顺序收集片段后一次拼接，避免批量替换反复复制整篇文档。
  const parts: string[] = [];
  let cursor = 0;
  for (const patch of sorted) {
    parts.push(document.slice(cursor, patch.start), patch.after);
    cursor = patch.end;
  }
  parts.push(document.slice(cursor));
  return parts.join('');
}

// Agent 写入同步标记：富文本编辑器同步到这份内容时不清空撤销历史，
// 让 Ctrl+Z 能原生撤销 AI 写入；其他外部载入仍清空历史，避免跨文档撤销。
let agentSyncContent: string | null = null;

/** 写入编辑器前登记本次 Agent 同步的目标内容（LF 形式）。 */
export function markAgentSync(content: string): void {
  agentSyncContent = content;
}

/** 内容同步时核对并消费标记：命中代表这次同步来自 Agent 写入。 */
export function consumeAgentSync(content: string): boolean {
  if (agentSyncContent !== content) return false;
  agentSyncContent = null;
  return true;
}

/** 同步窗口结束后清理未消费的标记，避免陈旧标记影响后续载入。 */
export function clearAgentSync(): void {
  agentSyncContent = null;
}

/** 只检查可确定的 Markdown 结构问题，不宣称验证文章事实或语言质量。 */
export function validateAgentDocument(document: string): string[] {
  const issues: string[] = [];
  let fence: { character: string; length: number; line: number } | null = null;
  let previousHeading = 0;
  document.split('\n').forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return;
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length, line: index + 1 };
      return;
    }
    const heading = /^ {0,3}(#{1,6})\s+/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (previousHeading && level > previousHeading + 1) issues.push(`第 ${index + 1} 行：标题从 ${previousHeading} 级跳到 ${level} 级`);
      previousHeading = level;
    }
  });
  // 循环回调中的赋值需要显式保留围栏类型，供 TypeScript 分析。
  const unclosed = fence as { line: number } | null;
  if (unclosed) issues.push(`第 ${unclosed.line} 行：代码围栏未闭合`);
  return issues;
}
