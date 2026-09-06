import type { DocumentPatch } from '../types/documentAgent';

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
  // 从后往前写入，前面的原文坐标不会受到后面修改的影响。
  return sorted.reverse().reduce((text, patch) =>
    text.slice(0, patch.start) + patch.after + text.slice(patch.end), document);
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
