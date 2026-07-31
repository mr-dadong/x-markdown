export const fileSystemService = {
  readDirectory: (directoryPath: string) =>
    window.electronAPI.readDirectory(directoryPath),
  getDirectoryName: (filePath: string) =>
    window.electronAPI.getDirectoryName(filePath),
  selectWorkspace: () => window.electronAPI.selectWorkspace(),
  getWorkspace: () => window.electronAPI.getWorkspace(),
  watchWorkspace: (directoryPath: string) => window.electronAPI.watchWorkspace(directoryPath),
  unwatchWorkspace: () => window.electronAPI.unwatchWorkspace(),
  onWorkspaceChanged: (callback: () => void) => window.electronAPI.onWorkspaceChanged(callback),
};
