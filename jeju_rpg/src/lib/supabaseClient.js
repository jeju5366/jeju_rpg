import { createClient } from '@supabase/supabase-js'
import { getDemoDb, isDemoActive } from '../demo/demoRuntime.js'
import { env, isSupabaseConfigured } from './env.js'

// singleton. 환경변수가 없으면 실제 클라이언트는 만들지 않는다. (앱은 계속 실행되고 Supabase 기능만 비활성)
const real = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

// Demo Mode 격리 경계: 모든 repo/서비스가 이 `supabase` 하나를 통해 DB/Storage 에 접근한다.
//   · Demo 가 아니면 실제 클라이언트로 그대로 위임한다. (production 동작 변화 없음)
//   · Demo 중에는 from / rpc / storage 만 Demo 메모리 DB 로 돌린다. → 퀘스트 완료/EXP/모험 선택/기록 저장 등 모든 쓰기가 실제 Supabase 로 나가지 않는다.
//   · auth 는 항상 실제 클라이언트다. (Demo 가 실제 로그인 세션을 바꾸지 않는다)
const DEMO_METHODS = new Set(['from', 'rpc', 'storage'])
export const supabase = new Proxy(real ?? {}, {
  get(target, prop) {
    if (DEMO_METHODS.has(prop) && isDemoActive()) {
      const demo = getDemoDb()
      if (demo) return demo.client[prop]
    }
    const value = target[prop]
    return typeof value === 'function' ? value.bind(target) : value
  },
})
