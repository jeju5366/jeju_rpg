import { Button, Modal } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import StyleSummaryView from './StyleSummaryView.jsx'

// 성향 테스트 저장 성공 직후 보여주는 결과 Modal. 닫거나 계속 버튼을 누르면 onContinue (이동만 하고 다시 저장하지 않는다).
export default function StyleResultModal({ summary, continueLabel, onContinue }) {
  const text = UI_TEXT.style
  return (
    <Modal show centered onHide={onContinue} backdrop="static" keyboard>
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5">
          {text.resultTitle}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <StyleSummaryView summary={summary} />
        <p className="small text-muted mt-3 mb-0">{text.baseNote}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button className="w-100" onClick={onContinue}>
          {continueLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
