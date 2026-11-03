import { useState } from 'react'
import { Alert, Button, Modal } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { useFreeTravelActions } from '../../hooks/useFreeTravel.js'
import { useFreeTravelStore } from '../../store/freeTravelStore.js'

// 진행 중인 모험에서 자유여행으로 전환하는 버튼. 누르면 바로 전환하지 않고 확인 모달을 먼저 보여준다.
// "자유여행 시작"을 확인했을 때만 서버에 요청하고, 이때 처음 위치 추적(= 위치 권한 요청)이 시작된다.
export default function FreeTravelStartButton({ adventureId, disabled, variant = 'outline-primary', className = '', label = null }) {
  const text = UI_TEXT.free
  const phase = useFreeTravelStore((s) => s.phase)
  const { start } = useFreeTravelActions()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (phase !== 'idle') return null // 이미 자유여행 중이거나 복귀 단계

  const close = () => {
    if (busy) return
    setOpen(false)
    setError(null)
  }

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await start(adventureId)
      setOpen(false)
    } catch (err) {
      setError(text.errors[err.code] ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant={variant} className={className} disabled={disabled || !adventureId} onClick={() => setOpen(true)}>
        {label ?? text.start}
      </Button>
      <Modal show={open} onHide={close} centered>
        <Modal.Header>
          <Modal.Title as="h2" className="h5">
            {text.startModal.title}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {text.startModal.lines.map((line) => (
            <p key={line} className="mb-2">
              {line}
            </p>
          ))}
          <p className="mb-0 text-muted small">{text.startModal.note}</p>
          {error && (
            <Alert variant="danger" className="small mt-3 mb-0">
              {error}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" disabled={busy} onClick={close}>
            {text.startModal.stay}
          </Button>
          <Button variant="primary" disabled={busy} onClick={confirm}>
            {busy ? text.startModal.working : text.startModal.confirm}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
