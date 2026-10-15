/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Public half of the VAPID key pair; unset hides the notifications setting. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}
