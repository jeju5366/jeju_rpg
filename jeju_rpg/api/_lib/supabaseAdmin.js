import { createClient } from '@supabase/supabase-js'
import { getSupabaseAuthConfig, requireEnv } from './env.js'

// 서버 전용 service_role 클라이언트. RLS 를 우회하므로 서버 함수에서만 쓰고,
// 호출 전에 반드시 requireUser 로 확인한 user.id 로 소유권을 직접 검사한다.
let client
export function getAdmin() {
  if (!client) {
    client = createClient(getSupabaseAuthConfig().url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}