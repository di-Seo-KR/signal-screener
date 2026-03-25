// ════════════════════════════════════════════════════════════════════
// Supabase 클라이언트 — DI금융 인증 시스템
// ════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tlszuuimorxcfohzirlz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hI8iYFSg2u3exL2KfAXQlA_tV4E6eE7";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,   // 수동 exchangeCodeForSession 사용 — 이중 교환 방지
    flowType: 'pkce',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
