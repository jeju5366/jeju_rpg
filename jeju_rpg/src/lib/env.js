// Vite 환경변수. 브라우저에 노출해도 되는 공개 키만 VITE_ 접두사를 쓴다.
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  // NAVER Dynamic Map 공개 키. 비어 있으면 지도 화면이 "지도를 쓸 수 없어" 안내로 대체된다. (앱의 나머지는 그대로 동작)
  naverMapClientId: import.meta.env.VITE_NAVER_MAP_CLIENT_ID ?? '',
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[env] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 비어 있어. .env 파일에 값을 넣어줘.',
  )
}
