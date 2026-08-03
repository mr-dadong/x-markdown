export const fileSystemService = {
  readDirectory: (directoryPath: string) =>
    window.electronAPI.readDirectory(directoryPath),
  createEntry: (parentPath: string, name: string, isDirectory: boolean) =>
    window.electronAPI.createFileTreeEntry(parentPath, name, isDirectory),
  renameEntry: (entryPath: string, newName: string) =>
    window.electronAPI.renameFileTreeEntry(entryPath, newName),
  deleteEntry: (entryPath: string) => window.electronAPI.deleteFileTreeEntry(entryPath),
  copyPath: (entryPath: string) => window.electronAPI.copyFileTreePath(entryPath),
  showEntry: (entryPath: string) => window.electronAPI.showFileTreeEntry(entryPath),
  getDirectoryName: (filePath: string) =>
    window.electronAPI.getDirectoryName(filePath),
  selectWorkspace: () => window.electronAPI.selectWorkspace(),
  getWorkspace: () => window.electronAPI.getWorkspace(),
  watchWorkspace: (directoryPath: string) => window.electronAPI.watchWorkspace(directoryPath),
  unwatchWorkspace: () => window.electronAPI.unwatchWorkspace(),
  onWorkspaceChanged: (callback: () => void) => window.electronAPI.onWorkspaceChanged(callback),
};
