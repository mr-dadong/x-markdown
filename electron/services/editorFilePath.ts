import path from "path";
import { fileURLToPath } from "url";
import { assertAuthorizedPath } from "./pathAccess";

/** Windows 盘符写法（C:\ 或 C:/）属于绝对路径，不能按「以 / 开头」处理。 */
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;

/**
 * 把文档里写的资源地址解析成可读取的绝对路径，并确保它落在授权范围内。
 *
 * Markdown 里的图片/附件地址有三种常见写法，语义各不相同：
 * - `assets/a.png`、`../images/a.png`：相对文档所在目录；
 * - `/images/a.png`：网页语境下表示「站点根目录」，但本地文档没有站点根；
 * - `file:///C:/x.png`：已经是绝对地址。
 */
export function resolvePathFromDocument(
  url: string,
  currentDocumentPath: string | null,
): string {
  if (currentDocumentPath) {
    assertAuthorizedPath(currentDocumentPath);
  } else {
    // 未保存的文档没有所在目录，只能以进程工作目录为基准。
    // 这里同样要先确认它在授权范围内：工作目录只有在用户把它选为工作区、
    // 或直接从该目录启动应用时才属于授权范围，否则相对地址一律无法解析 ——
    // 这是有意的安全边界，不会为了「未保存文档里的图片」而放开任意路径读取。
    assertAuthorizedPath(process.cwd());
  }
  const documentDirectory = currentDocumentPath
    ? path.dirname(currentDocumentPath)
    : process.cwd();
  const decodedUrl = url.startsWith("file:") ? "" : decodeURIComponent(url);

  // 以 / 开头的地址若直接交给 path.resolve，会被当成「当前盘符根目录」，
  // 解析成 C:\images\a.png —— 既不是用户放图片的位置，又落在授权范围之外，
  // 最终报出与真实原因无关的「无权访问该文件」。
  // 本地文档没有站点根，因此这类地址按「文档所在目录」解析，与本地编辑器直觉一致。
  return url.startsWith("file:")
    ? fileURLToPath(url)
    : decodedUrl.startsWith("/") && !WINDOWS_DRIVE_PATH_PATTERN.test(decodedUrl)
      ? path.resolve(documentDirectory, `.${decodedUrl}`)
      : path.resolve(documentDirectory, decodedUrl);
}

/**
 * 解析并确认目标落在授权范围内：图片、附件等读取链路的安全边界。
 * 需要按文件类型自行决定授权策略的调用方（如本地链接跳转）
 * 改用 resolvePathFromDocument 并自己做授权检查。
 */
export function resolveEditorFilePath(
  url: string,
  currentDocumentPath: string | null,
): string {
  return assertAuthorizedPath(
    resolvePathFromDocument(url, currentDocumentPath),
  );
}
