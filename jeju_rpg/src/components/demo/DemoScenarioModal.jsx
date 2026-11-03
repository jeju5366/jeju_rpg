import { ListGroup, Modal } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { DEMO_SCENARIOS } from '../../demo/scenarios.js'

// 발표용 시나리오 선택 Modal. (관리자 권한/RBAC 가 아니라 Demo Mode 진입점이다. 실제 여행 데이터에는 영향을 주지 않는다.)
export default function DemoScenarioModal({ show, onHide, onSelect, currentId = null }) {
  const text = UI_TEXT.demo
  return (
    <Modal show={show} onHide={onHide} centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5">
          {text.pickTitle}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted">{text.safeNote}</p>
        <ListGroup>
          {DEMO_SCENARIOS.map((scenario) => (
            <ListGroup.Item key={scenario.id} action active={scenario.id === currentId} onClick={() => onSelect(scenario.id)} className="demo-scenario">
              <div className="fw-bold">
                {scenario.emoji} {scenario.label}
              </div>
              <div className="small">{scenario.description}</div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Modal.Body>
    </Modal>
  )
}
