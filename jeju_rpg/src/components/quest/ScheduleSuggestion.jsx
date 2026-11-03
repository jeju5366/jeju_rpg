import { Alert, Button } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import FreeTravelStartButton from '../freeTravel/FreeTravelStartButton.jsx'

// REPLAN 제안 카드: "제안 → 사용자 승인 → REPLAN 실행".
//   Agent 가 상황을 감지해도 일정을 바로 바꾸지 않는다. [일정 다시 맞추기]를 눌러야 한 번 실행되고(승인 1회 = REPLAN 1회),
//   [기존 일정 계속]/[그대로 진행]은 아무것도 바꾸지 않는다.
//   실제 대체 후보가 없으면(noAlt) 억지로 만들지 않고 3가지를 제안한다: 기존 퀘스트 유지 / 현재 챕터 건너뛰기 / 자유여행으로 전환
export default function ScheduleSuggestion({ suggestion, adventureId, busy, message, noAlt, onKeep, onApprove, onNoAltKeep, onNoAltSkip }) {
  const text = UI_TEXT.schedule
  const s = text.suggest[suggestion.reason]
  const title =
    suggestion.reason === 'SCHEDULE_DELAY'
      ? (suggestion.severity === 'strong' ? s.strongTitle : s.title)(suggestion.detail.delayMinutes)
      : suggestion.reason === 'ACCOMMODATION_RISK'
        ? s.title(suggestion.detail.lateMinutes)
        : s.title
  const weatherNote = suggestion.reason === 'WEATHER_CHANGE' ? (suggestion.detail ?? []).map((r) => s.reasons[r]).filter(Boolean).join(' ') : null

  return (
    <Alert variant={suggestion.severity === 'strong' ? 'warning' : 'info'} className="mb-3">
      <div className="fw-bold">{title}</div>
      {weatherNote && <div className="small">{weatherNote}</div>}
      <div className="mb-2">{s.body}</div>

      {noAlt ? (
        <>
          <div className="fw-bold small">{text.noAlt.title}</div>
          <div className="small mb-2">{text.noAlt.body}</div>
          <div className="d-grid gap-2">
            <Button size="sm" variant="outline-secondary" disabled={busy} onClick={onNoAltKeep}>
              {text.noAlt.keep}
            </Button>
            <Button size="sm" variant="outline-secondary" disabled={busy} onClick={onNoAltSkip}>
              {text.noAlt.skip}
            </Button>
            <FreeTravelStartButton adventureId={adventureId} disabled={busy} variant="outline-info" className="w-100" label={text.noAlt.free} />
          </div>
        </>
      ) : (
        <>
          {message && <div className="small mb-2">{message}</div>}
          <div className="d-flex flex-wrap gap-2">
            <Button size="sm" variant="outline-secondary" disabled={busy} onClick={onKeep}>
              {suggestion.reason === 'WEATHER_CHANGE' ? text.keepWeather : text.keep}
            </Button>
            <Button size="sm" variant={suggestion.severity === 'strong' ? 'warning' : 'primary'} disabled={busy} onClick={onApprove}>
              {busy ? text.working : text.replan}
            </Button>
          </div>
          <div className="small text-muted mt-2">{text.approveHint}</div>
        </>
      )}
    </Alert>
  )
}
