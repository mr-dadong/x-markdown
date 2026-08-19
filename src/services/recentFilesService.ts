// 最近打开列表只通过此服务访问桌面端能力。
export const recentFilesService = {
  list: (): Promise<string[]> => window.electronAPI.getRecentFiles(),
  add: (filePaths: string[]): Promise<void> =>
    window.electronAPI.addRecentFiles(filePaths),
  remove: (filePath: string): Promise<void> =>
    window.electronAPI.removeRecentFile(filePath),
  clear: (): Promise<void> => window.electronAPI.clearRecentFiles(),
};
