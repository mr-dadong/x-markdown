import path from "path";

const authorizedDirectoryRoots = new Set<string>();
const authorizedFiles = new Set<string>();

const normalizeFilePath = (filePath: string): string => {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32"
    ? resolvedPath.toLocaleLowerCase()
    : resolvedPath;
};

// 打开文档后，同时授权文档本身和同级资源目录。
export function authorizeDocument(filePath: string): void {
  authorizedFiles.add(normalizeFilePath(filePath));
  authorizedDirectoryRoots.add(normalizeFilePath(path.dirname(filePath)));
}

// 用户通过文件选择器选择的单个文件也可以被后续操作访问。
export function authorizeFile(filePath: string): void {
  authorizedFiles.add(normalizeFilePath(filePath));
}

function isPathInside(candidatePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

// 所有文件 IPC 都应先经过这里，避免渲染进程读取任意系统文件。
export function assertAuthorizedPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  const normalizedPath = normalizeFilePath(resolvedPath);
  const isAuthorized =
    authorizedFiles.has(normalizedPath) ||
    [...authorizedDirectoryRoots].some((root) =>
      isPathInside(normalizedPath, root),
    );
  if (!isAuthorized) {
    throw new Error("无权访问该文件，请先通过打开对话框选择它");
  }
  return resolvedPath;
}
