export const fileSystemService = {
  readDirectory: (directoryPath: string) =>
    window.electronAPI.readDirectory(directoryPath),
  getDirectoryName: (filePath: string) =>
    window.electronAPI.getDirectoryName(filePath),
};
