/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*?url' {
  const src: string;
  export default src;
}
