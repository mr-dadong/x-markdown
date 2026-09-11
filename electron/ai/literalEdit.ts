/** 统计 needle 在 content 中不重叠出现的次数。 */
function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

/** 统一换行为 LF，让模型给出的文本能与 Windows 文档精确匹配。 */
export function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

/** 只做明确的字面替换：默认要求唯一匹配，replaceAll 为 true 时替换全部出现。 */
export function applyLiteralEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { content: string; replacements: number } {
  const oldNorm = normalizeLineEndings(oldString);
  if (oldNorm.length === 0)
    throw new Error("old_string 不能为空；新建或全文改写请使用 write");
  const newNorm = normalizeLineEndings(newString);
  if (oldNorm === newNorm) throw new Error("old_string 和 new_string 必须不同");
  const replacements = countOccurrences(content, oldNorm);
  if (replacements === 0)
    throw new Error(
      "old_string 在当前草稿中不存在；read 返回的是最新正文，请读取后重新定位，不要重复已完成的修改",
    );
  if (!replaceAll && replacements > 1)
    throw new Error(
      `old_string 匹配 ${replacements} 次；提供更完整的上下文，或明确设置 replace_all 为 true`,
    );
  return { content: content.split(oldNorm).join(newNorm), replacements };
}
