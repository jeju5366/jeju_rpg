import { Alert, Button } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'

// 오늘 일정에 영향을 주는 조건이 바뀌었을 때의 제안. 자동으로 REPLAN 을 호출하지 않고 사용자가 고른다.
//  - "다음 모험부터 반영": 아무것도 호출하지 않고 제안만 닫는다. (바뀐 값은 이미 저장되어 다음 Agent 호출에 쓰인다)
//  - "오늘 일정 다시 맞추기": 이때만 REPLAN_ADVENTURE 를 한 번 요청한다.
export default function ReplanSuggestion({ busy, message, onLater, onNow }) {
  const text = UI_TEXT.replan
  return (
    <Alert variant="warning" className="mb-3">
      <div className="fw-bold">{text.title}</div>
      <div className="mb-2">{text.body}</div>
      {message && <div className="small mb-2">{message}</div>}
      <div className="d-flex flex-wrap gap-2">
        <Button size="sm" variant="outline-secondary" disabled={busy} onClick={onLater}>
          {text.later}
        </Button>
        <Button size="sm" variant="warning" disabled={busy} onClick={onNow}>
          {busy ? text.working : text.now}
        </Button>
      </div>
    </Alert>
  )
}