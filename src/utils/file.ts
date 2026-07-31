// 状态栏使用同一份统计结果，避免分别遍历长文档。
export interface DocumentStats {
  lineCount: number;
  wordCount: number;
  characterCount: number;
}

/**
 * 统计 Markdown 文档的行、词和字符。
 * 中文按单字计词，英文和数字按连续词组计词；字符包含空格但不包含换行符。
 */
export const getDocumentStats = (text: string): DocumentStats => {
  if (!text) {
    return { lineCount: 0, wordCount: 0, characterCount: 0 };
  }

  const words = text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) ?? [];
  const characters = Array.from(text.replace(/\r?\n|\r/g, ""));

  return {
    lineCount: text.split(/\r?\n|\r/).length,
    wordCount: words.length,
    characterCount: characters.length,
  };
};

/**
 * 从目录路径中提取目录名
 * @param dirPath 目录路径
 * @returns 目录名
 */
export const getDirectoryName = (dirPath: string | null): string => {
  if (!dirPath) return "本地文稿";
  return dirPath.split(/[/\\]/).filter(Boolean).pop() ?? "本地文稿";
};

/**
 * 检查文件是否是 Markdown 文件
 * @param fileName 文件名
 * @returns 是否是 Markdown 文件
 */
export const isMarkdownFile = (fileName: string): boolean => {
  return (
    fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase().endsWith(".markdown")
  );
};

/**
 * 从文件路径中提取文件名
 * @param filePath 文件路径
 * @returns 文件名
 */
export const getFileName = (filePath: string | null): string => {
  if (!filePath) return "未命名.md";
  return filePath.split(/[/\\]/).pop() ?? "未命名.md";
};
