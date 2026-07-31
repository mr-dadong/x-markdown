import type { ApplicationMenuPosition } from "../types/electron";

export const windowService = {
  minimize: () => window.electronAPI.minimizeWindow(),
  maximize: () => window.electronAPI.maximizeWindow(),
  close: () => window.electronAPI.closeWindow(),
  showApplicationMenu: (position: ApplicationMenuPosition) =>
    window.electronAPI.showApplicationMenu(position),
  openExternalLink: (url: string) =>
    window.electronAPI.openExternalLink(url),
};
