/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Port of the dev review-host when Vite serves the UI (default 1234). */
  readonly VITE_HOST_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*?url' {
  const src: string;
  export default src;
}
