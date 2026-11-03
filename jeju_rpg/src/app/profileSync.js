// 로그인 사용자의 프로필 sync (실제 사용자 전용). useAuthBootstrap 이 쓰고, 의존성을 주입받아 비동기 race 를 테스트할 수 있다.
//
// Demo Mode 와의 경계: Demo 중에는 supabase 가 Demo DB 로 전환되어 있다.
//   · 시작 전에 Demo 면 아무것도 하지 않는다.
//   · 기다리는 도중 Demo 가 시작(또는 시작했다 끝남)됐다면, 성공/실패 어느 쪽이든 결과를 버리고 실제(base) auth store 를 건드리지 않는다.
//     (profile / onboardingCompleted / initializing / profileRefreshing / profileError 모두 그대로. catch 의 setProfile(null)·setProfileError 도 실행하지 않는다)
//   · 시작 전에 켜 둔 로딩 표시(initializing/profileRefreshing)가 Demo 뒤에 남지 않도록, Demo 가 끝나면 같은 sync 를 실제 사용자 기준으로 다시 한다.
//
// deps: authBase(실제 store) / ensureProfile / isDemoActive / getEpoch(Demo 시작·종료 때마다 바뀜) / whenDemoEnds(fn) / onSynced
export function createProfileSync({ authBase, ensureProfile, isDemoActive, getEpoch, whenDemoEnds, onSynced = () => {} }) {
  return async function syncProfile(session, { background }) {
    if (isDemoActive()) return
    const epoch = getEpoch()
    const { setProfile, setInitializing, setProfileRefreshing, setProfileError } = authBase.getState()
    if (background) setProfileRefreshing(true)
    else setInitializing(true)

    const interrupted = () => isDemoActive() || getEpoch() !== epoch // 기다리는 사이 Demo 가 시작되었거나, 시작했다 끝난 경우 (읽은 값이 Demo DB 값일 수 있다)
    let deferred = false
    try {
      const fresh = await ensureProfile(session.user.id)
      if (interrupted()) {
        deferred = true
        return
      }
      setProfile(fresh)
      setProfileError(null)
      onSynced()
    } catch (error) {
      if (interrupted()) {
        deferred = true
        return
      }
      console.error('[auth] 프로필을 불러오지 못했어', error)
      // 백그라운드 실패는 기존 프로필을 그대로 두고 조용히 넘어간다. 처음 로딩 실패일 때만 오류를 보여준다.
      if (!background) {
        setProfile(null)
        setProfileError(error.message)
      }
    } finally {
      if (deferred) whenDemoEnds(() => syncProfile(session, { background })) // base 로딩 표시는 건드리지 않고, Demo 가 끝나면 실제 기준으로 다시 sync
      else if (background) setProfileRefreshing(false)
      else setInitializing(false)
    }
  }
}
