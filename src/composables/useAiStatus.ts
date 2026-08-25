import { onMounted, ref } from "vue";
import { aiService } from "../services/aiService";
import type { AiStatus } from "../types/ai";

/**
 * 轻量级 AI 状态查询：用于判断 AI 是否已配置完成，
 * 在选区工具栏、AI 面板等入口处决定展示何种 UI。
 */
export const useAiStatus = () => {
  const status = ref<AiStatus | null>(null);
  const loading = ref(true);

  const refresh = async (): Promise<void> => {
    loading.value = true;
    try {
      status.value = await aiService.getStatus();
    } catch {
      status.value = null;
    } finally {
      loading.value = false;
    }
  };

  const isConfigured = (): boolean => Boolean(status.value?.configured);

  onMounted(() => void refresh());

  return { status, loading, refresh, isConfigured };
};
