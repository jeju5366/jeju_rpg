import { Alert, Button } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import FreeTravelStartButton from '../freeTravel/FreeTravelStartButton.jsx'

// 일정이 30분 이상 빨라졌을 때의 추가 콘텐츠 제안(Bonus Opportunity). REPLAN 이 아니다: 기존 다음 챕터는 그대로 유지된다.
// 우선순위: 숨은 선택 퀘스트가 남아 있으면 "퀘스트 더 받기" → 돌발 퀘스트 → 자유여행 → 아무것도 원하지 않으면 그냥 다음 챕터. 하나도 소비할 필요 없다.
export default function BonusOpportunity({ aheadMinutes, hiddenCount, adventureId, busy, message, onMore, onSurprise, onDismiss }) {
  const text = UI_TEXT.schedule.bonus
  return (
    <Alert variant="success" className="mb-3">
      <div className="fw-bold">{text.title}</div>
      <div className="small mb-2">{text.body(aheadMinutes)}</div>
      {message && <div className="small mb-2">{message}</div>}
      <div className="d-flex flex-wrap gap-2">
        {hiddenCount > 0 && (
          <Button size="sm" variant="outline-success" disabled={busy} onClick={onMore}>
            {text.more} ({hiddenCount})
          </Button>
        )}
        <Button size="sm" variant="outline-success" disabled={busy} onClick={onSurprise}>
          {text.surprise}
        </Button>
        <FreeTravelStartButton adventureId={adventureId} disabled={busy} variant="outline-info" label={text.free} />
        <Button size="sm" variant="link" disabled={busy} onClick={onDismiss}>
          {text.next}
        </Button>
      </div>
    </Alert>
  )
}
