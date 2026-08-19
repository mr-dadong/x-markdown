import { ref } from "vue";
import { recentFilesService } from "../services/recentFilesService";

// 最近打开列表是全局共享状态：文档打开记录与欢迎页展示使用同一份数据。
const recentFiles = ref<string[]>([]);

export const useRecentFiles = () => {
  const loadRecentFiles = async (): Promise<void> => {
    recentFiles.value = await recentFilesService.list();
  };

  const addRecentFiles = async (filePaths: string[]): Promise<void> => {
    if (filePaths.length === 0) return;
    await recentFilesService.add(filePaths);
    recentFiles.value = await recentFilesService.list();
  };

  const removeRecentFile = async (filePath: string): Promise<void> => {
    await recentFilesService.remove(filePath);
    recentFiles.value = await recentFilesService.list();
  };

  const clearRecentFiles = async (): Promise<void> => {
    await recentFilesService.clear();
    recentFiles.value = [];
  };

  return {
    recentFiles,
    loadRecentFiles,
    addRecentFiles,
    removeRecentFile,
    clearRecentFiles,
  };
};
