import { useState } from 'react'
import { Badge, Button, Modal } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { UI_TEXT } from '../../constants/uiText.js'
import { endDemo, runDemoControl, switchDemoScenario } from '../../demo/demoController.js'
import { useAgentLogStore } from '../../store/agentLogStore.js'
import { useAuthStore } from '../../store/authStore.js'
import { useDemoStore } from '../../store/demoStore.js'
import DemoScenarioModal from './DemoScenarioModal.jsx'

// Demo 중 모든 화면 위에 고정되는 표시줄: "DEMO · 🌧 비 오는 날" + 시나리오 변경 / Demo 종료 (+ 시나리오별 동작).
export default function DemoStatusBar() {
  const text = UI_TEXT.demo
  const navigate = useNavigate()
  const { label, scenarioId, controls } = useDemoStore()
  const openLog = useAgentLogStore((s) => s.openPanel)
  const [picking, setPicking] = useState(false)
  const [ending, setEnding] = useState(false)

  const change = (id) => {
    switchDemoScenario(id) // 이전 시나리오의 REPLAN/보상/Final Quest 등 임시 상태를 모두 비우고 새로 시작한다
    setPicking(false)
    navigate('/', { replace: true })
  }
  const finish = () => {
    setEnding(false)
    endDemo()
    // 실제 로그인 세션은 그대로다. 로그인 상태면 홈으로, 아니면 로그인 화면으로 돌아간다.
    navigate(useAuthStore.getState().session ? '/' : '/auth', { replace: true })
  }

  return (
    <div className="demo-bar" role="status">
      <Badge bg="warning" text="dark">
        DEMO
      </Badge>
      <span className="demo-bar__label">{label}</span>
      <span className="demo-bar__spacer" />
      {controls.map((control) => (
        <Button key={control.id} size="sm" variant="outline-dark" onClick={() => runDemoControl(control.id)}>
          {control.label}
        </Button>
      ))}
      <Button size="sm" variant="outline-dark" className="d-xl-none" onClick={openLog}>
        {text.log}
      </Button>
      <Button size="sm" variant="dark" onClick={() => setPicking(true)}>
        {text.change}
      </Button>
      <Button size="sm" variant="outline-danger" onClick={() => setEnding(true)}>
        {text.end}
      </Button>

      <DemoScenarioModal show={picking} onHide={() => setPicking(false)} onSelect={change} currentId={scenarioId} />
      <Modal show={ending} onHide={() => setEnding(false)} centered>
        <Modal.Body>{text.endConfirm}</Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setEnding(false)}>
            {text.cancel}
          </Button>
          <Button variant="danger" onClick={finish}>
            {text.endYes}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
