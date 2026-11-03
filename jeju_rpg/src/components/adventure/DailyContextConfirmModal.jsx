import { useState } from 'react'
import { Alert, Button, ListGroup, Modal } from 'react-bootstrap'
import DailyContextFields from '../common/DailyContextFields.jsx'
import { COMPANIONS, TRANSPORTS } from '../../constants/onboarding.js'
import { UI_TEXT } from '../../constants/uiText.js'

const labelOf = (list, id) => list.find((item) => item.id === id)?.label ?? id

// 그날 처음 "오늘의 모험 만들기"를 누르면 Agent 를 바로 부르지 않고 이 확인 단계를 먼저 보여준다.
//  - "이대로 모험 시작": 보이는 값(전날/여행 기본값)을 그날 조건으로 저장하고 시작
//  - "수정하기" → 값을 고친 뒤 "저장하고 모험 시작": 최신 값을 저장한 뒤 그 값으로 시작
// onStart(values) 는 저장 + 모험 생성을 한 번에 처리한다. (저장이 끝난 뒤에만 Agent 를 호출한다)
export default function DailyContextConfirmModal({ show, initialValues, source, busy, error, onStart, onClose }) {
  const text = UI_TEXT.daily
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState(initialValues)
  const sourceNote = source === 'previous' ? text.fromPrevious : source === 'trip' ? text.fromTrip : null

  return (
    <Modal show={show} onHide={busy ? undefined : onClose} centered>
      <Modal.Header>
        <Modal.Title as="h2" className="h5">
          {text.confirmTitle}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">
          {text.confirmDesc} {sourceNote}
        </p>
        {error && <Alert variant="danger">{error}</Alert>}
        {editing ? (
          <DailyContextFields values={values} onChange={setValues} disabled={busy} />
        ) : (
          <ListGroup variant="flush">
            <ListGroup.Item className="d-flex justify-content-between px-0">
              <span>{text.companion}</span>
              <strong>
                {labelOf(COMPANIONS, values.companion)}
                {Number(values.party_size) > 1 ? ` (${values.party_size}${UI_TEXT.home.people})` : ''}
              </strong>
            </ListGroup.Item>
            <ListGroup.Item className="d-flex justify-content-between px-0">
              <span>{text.transport}</span>
              <strong>{labelOf(TRANSPORTS, values.transport)}</strong>
            </ListGroup.Item>
            <ListGroup.Item className="d-flex justify-content-between px-0">
              <span>{text.desiredEnd}</span>
              <strong>{values.desired_end_time ?? text.noEndTime}</strong>
            </ListGroup.Item>
          </ListGroup>
        )}
      </Modal.Body>
      <Modal.Footer>
        {editing ? (
          <>
            <Button variant="outline-secondary" disabled={busy} onClick={() => setEditing(false)}>
              {text.back}
            </Button>
            <Button disabled={busy} onClick={() => onStart(values)}>
              {busy ? text.working : text.saveAndStart}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline-secondary" disabled={busy} onClick={() => setEditing(true)}>
              {text.edit}
            </Button>
            <Button disabled={busy} onClick={() => onStart(values)}>
              {busy ? text.working : text.startAsIs}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  )
}