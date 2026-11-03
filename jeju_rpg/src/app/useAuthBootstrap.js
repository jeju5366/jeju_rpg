import { useEffect } from 'react'
import { subscribeAuthChange } from '../services/supabase/authService.js'
import { ensureProfile } from '../services/supabase/profileService.js'
import { useAuthStore } from '../store/authStore.js'
import { isSupabaseConfigured } from '../lib/env.js'
import { getDemoEpoch, isDemoActive } from '../demo/demoRuntime.js'
import { useDemoStore } from '../store/demoStore.js'
import { createProfileSync } from './profileSync.js'

// 탭 복귀 때 Supabase 가 SIGNED_IN 을 다시 보내도 같은 사용자면 이 간격 안에서는 프로필을 다시 읽지 않는다.
const BACKGROUND_REFRESH_MIN_MS = 60 * 1000

// 앱 시작 시 세션을 복원하고 로그인/로그아웃 변화를 store 에 반영한다.
//  - 최초 진입 / 다른 사용자 로그인: initializing → 전체 화면 로딩 허용
//  - 같은 사용자의 후속 동기화(탭 복귀, 세션 재확인, 토큰 갱신): 현재 화면 유지, profileRefreshing 만 켠다
export default function useAuthBootstrap() {
  useEffect(() => {
    // 이 훅은 항상 "실제" auth store 를 다룬다. (Demo 의 사용자 보기와 섞이지 않게 base store 를 직접 쓴다)
    const authBase = useAuthStore.base
    const store = authBase.getState()

    if (!isSupabaseConfigured) {
      store.setInitializing(false)
      return undefined
    }

    let syncedUserId = null
    let lastSyncAt = 0

    // 실제 사용자 프로필 sync. Demo 와의 경계(시작 전/대기 중/catch/finally)는 profileSync.js 가 처리한다.
    const syncProfile = createProfileSync({
      authBase,
      ensureProfile,
      isDemoActive,
      getEpoch: getDemoEpoch,
      onSynced: () => {
        lastSyncAt = Date.now()
      },
      whenDemoEnds: (fn) => {
        if (!useDemoStore.getState().active) return void queueMicrotask(fn)
        const unsubscribe = useDemoStore.subscribe((state) => {
          if (!state.active) {
            unsubscribe()
            fn()
          }
        })
      },
    })

    // 콜백 안에서 바로 supabase 를 호출하면 막힐 수 있어서 setTimeout 으로 넘긴다.
    return subscribeAuthChange((event, session) => {
      const { setSession, setInitializing, reset } = authBase.getState()
      if (!session) {
        syncedUserId = null
        reset()
        setInitializing(false)
        return
      }

      // 토큰이 같으면 session 객체를 갈아끼우지 않는다. (불필요한 리렌더 방지)
      if (authBase.getState().session?.access_token !== session.access_token) setSession(session)
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return

      if (syncedUserId !== session.user.id) {
        syncedUserId = session.user.id
        setTimeout(() => syncProfile(session, { background: false }), 0)
      } else if (Date.now() - lastSyncAt > BACKGROUND_REFRESH_MIN_MS) {
        setTimeout(() => syncProfile(session, { background: true }), 0)
      }
    })
  }, [])
}
