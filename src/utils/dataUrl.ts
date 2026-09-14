/**
 * data URL 解码工具。
 *
 * ZIP 导出与 Word 导出都需要把文档里的 data URL 还原成二进制字节，
 * 之前两边各写了一份完全相同的实现，这里收敛成唯一来源，
 * 避免以后修改解码规则时只改一处。
 */

/**
 * 把 data URL 解码为 MIME 类型与二进制内容。
 *
 * 支持 base64 与百分号编码两种载荷；无法识别的输入返回 null，
 * 由调用方决定跳过还是其它兜底处理。
 *
 * @param dataUrl 形如 `data:image/png;base64,iVBOR...` 的字符串
 * @returns 解码结果；格式不匹配时返回 null
 */
export const decodeDataUrl = (
  dataUrl: string,
): { mime: string; bytes: Uint8Array } | null => {
  // 第一段是 MIME 类型（可能省略），第二段标识 base64，第三段是载荷。
  const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  // 未声明 MIME 时按通用二进制处理，避免生成无类型的资源。
  const mime = match[1] || "application/octet-stream";
  const payload = match[3];
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { mime, bytes };
  }
  // 非 base64 的 data URL 使用百分号编码，先解码再按 UTF-8 取字节。
  const decoded = decodeURIComponent(payload);
  return { mime, bytes: new TextEncoder().encode(decoded) };
};
