import { useState } from 'react'
import { Alert, Button, Modal } from 'react-bootstrap'
import DailyContextFields from '../common/DailyContextFields.jsx'
import { UI_TEXT } from '../../constants/uiText.js'

// 홈의 "오늘 조건 수정". 저장만 하고 Agent 는 호출하지 않는다.
export default function DailyContextEditModal({ initialValues, busy, error, onSave, onClose }) {
  const text = UI_TEXT.home
  const [values, setValues] = useState(initialValues)

  return (
    <Modal show onHide={busy ? undefined : onClose} centered>
      <Modal.Header>
        <Modal.Title as="h2" className="h5">
          {text.dailyModalTitle}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <DailyContextFields values={values} onChange={setValues} disabled={busy} />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" disabled={busy} onClick={onClose}>
          {text.cancel}
        </Button>
        <Button disabled={busy} onClick={() => onSave(values)}>
          {busy ? text.saving : text.save}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}