import { useState } from 'react'
import { Alert, Badge, Button, Card, ListGroup } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { UI_TEXT } from '../../constants/uiText.js'
import { useFreeTravelActions } from '../../hooks/useFreeTravel.js'
import { requestReplanAfterFreeTravel } from '../../services/agent/replanService.js'
import { useFreeTravelStore } from '../../store/freeTravelStore.js'

// 자유여행 종료 후 모험 복귀 단계. 방문 저장 결과와 "그대로 돌아가도 되는지"(코드 판단)를 보여준다.
//  - 어긋남이 없으면 GPT 호출 없이 [모험으로 돌아가기]
//  - 어긋남이 있으면 [기존 일정 계속] / [일정 다시 맞추기]. 사용자가 "일정 다시 맞추기"를 눌렀을 때만 REPLAN(RETURN_FROM_FREE_TRAVEL) 을 요청한다.
//    (서버의 REPLAN 본체는 11단계. 지금은 요청 경로까지 연결되어 있고 501 이면 안내만 하고 기존 일정으로 계속한다)
export default function FreeTravelReturn() {
  const text = UI_TEXT.free.ret
  const result = useFreeTravelStore((s) => s.result)
  const { dismissReturn } = useFreeTravelActions()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  if (!result) return null
  const { saved, rejected, rewards, check } = result

  const goBack = () => {
    dismissReturn()
    navigate('/quest')
  }

  const replan = async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await requestReplanAfterFreeTravel({
        adventureId: result.adventureId,
        sessionId: result.sessionId,
        position: result.position,
        visitedPlaceIds: saved.map((v) => v.placeId),
        reasons: check.reasons,
      })
      // 실제 대체 후보가 없으면 억지로 바꾸지 않는다. 기존 일정으로 돌아가고, 퀘스트 화면에서 건너뛰기/자유여행을 고를 수 있다.
      if (response.status === 'no_alternative') {
        setMessage(UI_TEXT.schedule.noAlt.title)
        return
      }
      goBack()
    } catch (err) {
      // 실패해도 기존 모험은 그대로 이어진다
      setMessage(UI_TEXT.schedule.errors[err.code] ?? UI_TEXT.schedule.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-3 border-success">
      <Card.Body>
        <Card.Title as="h2" className="h5">
          🧭 {text.title}
        </Card.Title>

        {rewards.discoveries.map((d) => (
          <div key={d.placeId} className="fw-bold small">
            ✨ {d.type === 'landmark' ? UI_TEXT.progression.reward.landmarkDiscovery : UI_TEXT.progression.reward.discovery} {d.placeName} · {UI_TEXT.categories.discovery} +{d.amount}{' '}
            {UI_TEXT.progression.reward.exp}
          </div>
        ))}
        {rewards.levelUps.map((up) => (
          <div key={up.category} className="fw-bold small">
            🎉 {up.category === 'overall' ? UI_TEXT.progression.reward.overall : (UI_TEXT.categories[up.category] ?? up.category)} {UI_TEXT.progression.reward.levelUp} Lv.{up.from} → Lv.{up.to}
          </div>
        ))}

        <div className="fw-bold small mt-2">{text.saved}</div>
        {saved.length === 0 ? (
          <div className="small text-muted">{text.noneSaved}</div>
        ) : (
          <ListGroup variant="flush" className="small mb-2">
            {saved.map((v) => (
              <ListGroup.Item key={v.placeId} className="px-0 py-1">
                {v.placeName}{' '}
                {v.evidence === 'none' && (
                  <Badge bg="secondary" className="ms-1">
                    {text.noEvidence}
                  </Badge>
                )}
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
        {rejected.length > 0 && (
          <Alert variant="warning" className="small py-2">
            {text.rejected}
            <ul className="mb-0">
              {rejected.map((r) => (
                <li key={r.placeId}>
                  {r.placeName ?? r.placeId} — {UI_TEXT.free.errors[r.code] ?? r.code}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <hr />
        {check.needsReplan ? (
          <>
            <div className="fw-bold mb-1">{text.askTitle}</div>
            <ul className="small text-muted">
              {check.reasons.map((reason) => (
                <li key={reason}>{text.reasons[reason] ?? reason}</li>
              ))}
            </ul>
            {message && (
              <Alert variant="warning" className="small py-2">
                {message}
              </Alert>
            )}
            <div className="d-grid gap-2">
              <Button variant="outline-secondary" disabled={busy} onClick={goBack}>
                {text.keep}
              </Button>
              <Button variant="warning" disabled={busy} onClick={replan}>
                {busy ? text.replanning : text.replan}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="small text-muted mb-2">{text.fine}</div>
            <Button className="w-100" onClick={goBack}>
              {text.resume}
            </Button>
          </>
        )}
      </Card.Body>
    </Card>
  )
}
