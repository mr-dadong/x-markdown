import { ref } from "vue";
import type { SettingsSection } from "../composables/useSettings";

// 应用级浮层使用独立状态，避免编辑器父视图的大量更新影响设置和 AI 的显示订阅。
const settingsOpen = ref(false);
const settingsSection = ref<SettingsSection>("general");
const aiChatOpen = ref(false);

export const overlayState = {
  settingsOpen,
  settingsSection,
  aiChatOpen,
};
