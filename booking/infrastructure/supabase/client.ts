/**
 * Browser Supabase client with the PUBLIC anon/publishable key only (ADR-002). The client is
 * created lazily on first use, so static prerendering (Node) never instantiates it.
 * Email OTP codes are typed on the same page, so no URL session detection / PKCE is needed.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { SupabaseConfig } from "./config"

export type SupabaseClientProvider = () => SupabaseClient

export function createSupabaseClientProvider(config: SupabaseConfig): SupabaseClientProvider {
  let client: SupabaseClient | null = null
  return () => {
    if (!client) {
      client = createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    }
    return client
  }
}
