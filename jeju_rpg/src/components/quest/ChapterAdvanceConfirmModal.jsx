import { Button, Modal } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'

// 챕터 이동 확인 모달. mode 에 따라 문구만 바뀐다.
//   skip      : 핵심 퀘스트 미완료 + 건너뛰기
//   remaining : 핵심 완료 + 남은 선택 퀘스트가 있음
//   allDone   : 핵심 + 선택 모두 완료 (경고 없음)
export default function ChapterAdvanceConfirmModal({ show, mode, isLast, busy, onStay, onConfirm }) {
  const text = UI_TEXT.progression
  const config = text.advanceModal[mode]
  if (!config) return null

  return (
    <Modal show={show} onHide={busy ? undefined : onStay} centered>
      <Modal.Header>
        <Modal.Title as="h2" className="h5">
          {config.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {config.lines.map((line) => (
          <p key={line} className="mb-2">
            {line}
          </p>
        ))}
        {isLast && <p className="mb-0 text-muted small">{text.advanceModal.lastChapterNote}</p>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" disabled={busy} onClick={onStay}>
          {config.stay}
        </Button>
        <Button variant={config.variant} disabled={busy} onClick={onConfirm}>
          {busy ? text.working : isLast && mode !== 'skip' ? text.advanceModal.lastConfirm : config.confirm}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}