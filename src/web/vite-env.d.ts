/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEAL_PLANNER_ENABLED?: string;
  readonly VITE_MEAL_COMPOSITION_V2_ENABLED?: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_GIT_COMMIT?: string;
  readonly VITE_BUILD_TIMESTAMP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  google?: {
    accounts?: {
      id?: {
        initialize: (config: any) => void;
        renderButton: (parent: HTMLElement, options: any) => void;
        prompt: (momentListener?: any) => void;
      };
    };
  };
}
