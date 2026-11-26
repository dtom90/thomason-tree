/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Browser API key with Google Picker API (+ Drive API) enabled */
  readonly VITE_GOOGLE_API_KEY?: string
  /** Optional GCP project number for PickerBuilder.setAppId */
  readonly VITE_GOOGLE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
