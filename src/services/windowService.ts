import type { ApplicationMenuPosition } from "../types/electron";

export const windowService = {
  minimize: () => window.electronAPI.minimizeWindow(),
  maximize: () => window.electronAPI.maximizeWindow(),
  close: () => window.electronAPI.closeWindow(),
  showApplicationMenu: (position: ApplicationMenuPosition) =>
    window.electronAPI.showApplicationMenu(position),
  openExternalLink: (url: string) =>
    window.electronAPI.openExternalLink(url),
  /** 用系统消息框告知失败原因，避免重要错误只留在控制台里。 */
  showErrorMessage: (title: string, message: string) =>
    window.electronAPI.showErrorMessage(title, message),
};
