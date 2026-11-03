import { useMemo } from 'react'
import { create } from 'zustand'
import { DEMO_USER_ID, getDemoDb } from '../demo/demoRuntime.js'
import { useDemoStore } from './demoStore.js'

// session/user/profile/onboarding
//  - initializing: 최초 진입(첫 세션 확인) 또는 다른 사용자로 바뀐 직후 첫 프로필 로딩 중. 이때만 전체 화면 로딩을 보여준다.
//  - profileRefreshing: 탭 복귀 / 세션 재확인 / 토큰 갱신 뒤의 프로필 재동기화. 화면은 그대로 두고 백그라운드로 처리한다.
const useBaseAuthStore = create((set) => ({
  session: null,
  user: null,
  profile: null,
  onboardingCompleted: false,
  initializing: true,
  profileRefreshing: false,
  profileError: null,

  setSession: (session) => set({ session, user: session?.user ?? null }),
  setProfile: (profile) =>
    set({ profile, onboardingCompleted: Boolean(profile?.onboarding_completed) }),
  setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),
  setInitializing: (initializing) => set({ initializing }),
  setProfileRefreshing: (profileRefreshing) => set({ profileRefreshing }),
  setProfileError: (profileError) => set({ profileError }),
  // 로그아웃: 사용자 데이터만 비운다. initializing 은 건드리지 않는다.
  reset: () =>
    set({
      session: null,
      user: null,
      profile: null,
      onboardingCompleted: false,
      profileRefreshing: false,
      profileError: null,
    }),
}))

// Demo Mode 에서 화면이 보는 "사용자" 모습. 실제 store(session/user/profile)는 건드리지 않고, 읽을 때만 Demo 사용자로 바꿔 보여준다.
// (실제 로그인 사용자가 Demo 에 들어가도, Demo 를 끝내면 원래 상태 그대로다. fake session 을 store 에 넣지 않는다.)
// Demo 중에는 프로필/온보딩/로딩 상태를 바꾸는 action 이 실제(base) store 를 수정하지 않는다. (Demo DB 에서 읽은 demo-user 프로필이 실제 사용자 프로필을 덮지 않게)
// Demo 프로필의 변경은 demoDb + profileVersion 경로로만 화면에 반영된다. session 관련 action(setSession/reset)은 실제 로그인 상태이므로 그대로 둔다.
const noop = () => {}
const DEMO_NOOP_ACTIONS = { setProfile: noop, setOnboardingCompleted: noop, setInitializing: noop, setProfileRefreshing: noop, setProfileError: noop }
function demoView(state, profileVersion) {
  const demo = getDemoDb()
  const profile = demo?.find('jeju_profiles', (p) => p.id === DEMO_USER_ID)
  void profileVersion
  return { ...state, ...DEMO_NOOP_ACTIONS, user: { id: DEMO_USER_ID }, profile: profile ? { ...profile } : null, onboardingCompleted: true, initializing: false, profileRefreshing: false, profileError: null }
}

// 기존 사용법을 그대로 유지한다: useAuthStore() / useAuthStore((s) => s.user) / useAuthStore.getState()
export function useAuthStore(selector = (s) => s) {
  const state = useBaseAuthStore((s) => s)
  const demoActive = useDemoStore((s) => s.active)
  const profileVersion = useDemoStore((s) => s.profileVersion)
  const view = useMemo(() => (demoActive ? demoView(state, profileVersion) : state), [state, demoActive, profileVersion])
  return selector(view)
}
useAuthStore.getState = () => {
  const demo = useDemoStore.getState()
  const state = useBaseAuthStore.getState()
  return demo.active ? demoView(state, demo.profileVersion) : state
}
useAuthStore.base = useBaseAuthStore // 실제 auth store (Auth bootstrap 처럼 Demo 와 무관하게 실제 상태를 다뤄야 하는 곳 전용)
useAuthStore.setState = useBaseAuthStore.setState
useAuthStore.subscribe = useBaseAuthStore.subscribe
