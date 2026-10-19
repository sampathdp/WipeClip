import type { SupportedStorage } from "@supabase/supabase-js";

/** Supabase auth storage for the desktop app, backed by the OS credential
 * store (Windows Credential Manager, macOS Keychain) through the Rust
 * commands in src-tauri/src/secure_storage.rs - the refresh token never
 * sits in plaintext in the WebView's localStorage. The Rust side only
 * accepts Supabase's own auth keys.
 */
async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const secureAuthStorage: SupportedStorage = {
  getItem: (key) => call<string | null>("secure_storage_get", { key }),
  setItem: (key, value) => call<void>("secure_storage_set", { key, value }),
  removeItem: (key) => call<void>("secure_storage_remove", { key }),
};
