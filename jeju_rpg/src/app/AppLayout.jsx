import { useEffect } from 'react'
import { Alert, Button, Offcanvas } from 'react-bootstrap'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import AgentLogPanel from '../components/agent/AgentLogPanel.jsx'
import DemoStatusBar from '../components/demo/DemoStatusBar.jsx'
import BottomNav from '../components/layout/BottomNav.jsx'
import { HIDE_NAV_ROUTES } from '../constants/routes.js'
import { UI_TEXT } from '../constants/uiText.js'
import { restoreDemoIfNeeded } from '../demo/demoController.js'
import { useFreeTravelRuntime } from '../hooks/useFreeTravel.js'
import { signOut } from '../services/supabase/authService.js'
import { useAgentLogStore } from '../store/agentLogStore.js'
import { useAuthStore } from '../store/authStore.js'
import { useDemoStore } from '../store/demoStore.js'
import useAuthBootstrap from './useAuthBootstrap.js'

export default function AppLayout() {
  useAuthBootstrap()
  useFreeTravelRuntime() // 진행 중인 자유여행 이어받기 + (자유여행 중에만) 위치 추적. Demo 중에는 Demo DB/시뮬레이션 위치를 쓴다.
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { session, profileError } = useAuthStore()
  const demo = useDemoStore((s) => s.active)
  const { panelOpen, openPanel, closePanel } = useAgentLogStore()
  const showNav = (session || demo) && !HIDE_NAV_ROUTES.includes(pathname)
  const showLog = session || demo // 데스크톱 넓은 화면에서 우측 Agent Log 패널

  // 새로고침해도 발표 중 Demo 가 이어지게 한다 (sessionStorage 의 시나리오를 처음 상태로 다시 만든다)
  useEffect(() => {
    restoreDemoIfNeeded()
  }, [])

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/auth', { replace: true })
    } catch (error) {
      console.error('[auth] 로그아웃 실패', error)
    }
  }

  return (
    <div className="app-shell">
      {demo && <DemoStatusBar />}
      {(session || demo) && (
        <header className="app-header container-fluid d-flex justify-content-between align-items-center py-2">
          <strong>{UI_TEXT.appName}</strong>
          <div className="d-flex gap-2">
            {import.meta.env.DEV && !demo && (
              <Button size="sm" variant="outline-secondary" className="d-xl-none" onClick={openPanel}>
                {UI_TEXT.demo.log}
              </Button>
            )}
            {!demo && (
              <Button size="sm" variant="outline-secondary" onClick={handleSignOut}>
                {UI_TEXT.auth.signOut}
              </Button>
            )}
          </div>
        </header>
      )}
      <div className="app-body">
        <main className="app-main container-fluid py-3">
          {profileError && !demo && (
            <Alert variant="warning">
              {UI_TEXT.auth.profileLoadFailed} ({profileError})
            </Alert>
          )}
          <Outlet />
        </main>
        {showLog && (
          <aside className="agent-log-aside d-none d-xl-block">
            <AgentLogPanel />
          </aside>
        )}
      </div>
      {showNav && <BottomNav />}

      {/* 모바일/좁은 화면: 필요할 때만 여는 오프캔버스 (기본 숨김) */}
      <Offcanvas show={panelOpen && Boolean(showLog)} onHide={closePanel} placement="bottom" className="agent-log-offcanvas">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title as="h2" className="h6">
            {UI_TEXT.agentLog.title}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <AgentLogPanel hideTitle />
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  )
}
