/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __BUILT_AT__: string;
interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
  /** Native builds only: the remote API origin. Empty = same-origin website. */
  readonly VITE_API_BASE?: string;
}
