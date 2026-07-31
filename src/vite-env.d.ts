/// <reference types="vite/client" />

import type { ElectronAPI } from "./types/electron";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
