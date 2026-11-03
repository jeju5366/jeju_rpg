import { Navigate, Outlet } from 'react-router-dom'
import { Spinner } from 'react-bootstrap'
import { useAuthStore } from '../../store/authStore.js'
import { useDemoStore } from '../../store/demoStore.js'

function FullSpinner() {
  return (
    <div className="d-flex justify-content-center py-5">
      <Spinner animation="border" role="status" />
    </div>
  )
}

// 전체 화면 로딩은 initializing(최초 진입/사용자 전환)일 때만. 탭 복귀 같은 후속 동기화로는 화면을 바꾸지 않는다.
// 로그인 필요. 온보딩 Route(/character, /style-test, /setup)에 사용.
export function RequireAuth() {
  const { session, initializing } = useAuthStore()
  const demo = useDemoStore((s) => s.active)
  if (demo) return <Outlet />
  if (initializing) return <FullSpinner />
  if (!session) return <Navigate to="/auth" replace />
  return <Outlet />
}

// 로그인 + 온보딩 완료 필요. 홈/모험/퀘스트/지도/기록/모험가에 사용.
export function RequireOnboarding() {
  const { session, initializing, onboardingCompleted } = useAuthStore()
  const demo = useDemoStore((s) => s.active)
  if (demo) return <Outlet />
  if (initializing) return <FullSpinner />
  if (!session) return <Navigate to="/auth" replace />
  if (!onboardingCompleted) return <Navigate to="/character" replace />
  return <Outlet />
}

// /auth 전용. 이미 로그인했으면 홈으로 보낸다. (홈 가드가 온보딩 여부를 다시 판단)
export function RedirectIfAuthed() {
  const { session, initializing } = useAuthStore()
  if (initializing) return <FullSpinner />
  if (session) return <Navigate to="/" replace />
  return <Outlet />
}