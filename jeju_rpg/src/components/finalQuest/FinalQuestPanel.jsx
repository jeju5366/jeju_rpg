import { useState } from 'react'
import { Alert, Badge, Button, Card } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { UI_TEXT } from '../../constants/uiText.js'
import useGeolocation from '../../hooks/useGeolocation.js'
import { hhmm } from '../../utils/format.js'
import { airportFocusTarget } from '../../utils/questLocation.js'
import useViewOnMap from '../map/useViewOnMap.js'

// Final Quest 카드. 상태는 서버(useFinalQuest)가 정하고, 이 컴포넌트는 그 결과를 보여주고 버튼 동작만 연결한다.
//   notice(공항 이동 준비) / active(이동 안내) / moving(이동 중) / arrived(도착 완료, [여행 마무리]) / flight_cancelled / needs_flight_info
// 14단계에서 이 컴포넌트와 .final-quest CSS 만 교체하면 연출을 바꿀 수 있다.
export default function FinalQuestPanel({ fq, onEditFlight }) {
  const t = UI_TEXT.finalQuest
  const navigate = useNavigate()
  const { locateAccurate } = useGeolocation()
  const viewOnMap = useViewOnMap()
  // Final Quest 중에는 일반 퀘스트 목적지 대신 제주공항이 지도의 최우선 목적지다.
  const airportMapButton = (
    <Button variant="outline-secondary" size="sm" className="mt-2 w-100" onClick={() => viewOnMap(airportFocusTarget())}>
      ✈️ {t.card.airportMap}
    </Button>
  )
  const [message, setMessage] = useState(null)
  const [locating, setLocating] = useState(false)
  const { state, busy } = fq
  if (!state) return null

  const fail = (err) => {
    const fn = t.errors[err.code]
    setMessage(typeof fn === 'function' ? fn(err.details?.distanceMeters) : (fn ?? err.message))
  }

  const handleStart = () => fq.start().catch(fail)
  const handleArrive = async () => {
    if (locating || busy) return
    setLocating(true)
    setMessage(null)
    try {
      const located = await locateAccurate()
      if (!located.ok) return setMessage(t.errors[located.error] ?? t.errors.position_unavailable)
      await fq.arrive(located.position)
    } catch (err) {
      fail(err)
    } finally {
      setLocating(false)
    }
  }
  const handleFinish = async () => {
    setMessage(null)
    try {
      const { record } = await fq.finish()
      navigate(`/summary/${record.trip.id}`)
    } catch (err) {
      fail(err)
    }
  }

  if (state.status === 'notice') {
    return (
      <Alert variant="warning" className="small final-quest-notice">
        <strong>{t.notice.title}</strong>
        <div>{t.notice.body(hhmm(state.safe?.latestSafeDeparture))}</div>
      </Alert>
    )
  }
  if (state.status === 'needs_flight_info') {
    return (
      <Alert variant="info" className="small">
        <strong>{t.needsFlight.title}</strong>
        <div>{t.needsFlight.body}</div>
      </Alert>
    )
  }
  if (state.status === 'flight_cancelled') {
    return (
      <Card className="mb-3 final-quest final-quest--cancelled">
        <Card.Body>
          <Badge bg="danger" className="mb-2">
            {t.card.badge}
          </Badge>
          <Card.Title as="h2" className="h5">
            {t.cancelled.title}
          </Card.Title>
          <Card.Text>{t.cancelled.body}</Card.Text>
          <div className="d-flex gap-2">
            {onEditFlight && (
              <Button variant="outline-primary" size="sm" onClick={onEditFlight}>
                {t.cancelled.edit}
              </Button>
            )}
            <Button variant="outline-secondary" size="sm" disabled={busy} onClick={() => fq.refresh()}>
              {t.cancelled.recheck}
            </Button>
          </div>
        </Card.Body>
      </Card>
    )
  }
  if (!['active', 'moving', 'arrived'].includes(state.status)) return null

  const { safe, flight, endedCounts } = state
  const ended = (endedCounts?.core ?? 0) + (endedCounts?.optional ?? 0) + (endedCounts?.surprise ?? 0)
  const estimate = safe?.travelSource === 'directions' ? '' : ` ${t.card.estimate}`

  if (state.status === 'arrived') {
    return (
      <Card className="mb-3 final-quest final-quest--complete">
        <Card.Body>
          <Badge bg="success" className="mb-2">
            {t.card.complete}
          </Badge>
          <Card.Title as="h2" className="h5">
            {t.card.completeBody}
          </Card.Title>
          <div className="final-quest__exp">{t.card.exp}</div>
          <div className="small text-muted mb-3">{t.card.expNote}</div>
          {message && <Alert variant="warning" className="small py-2">{message}</Alert>}
          <Button className="w-100" disabled={busy} onClick={handleFinish}>
            {busy ? t.card.finishing : t.card.finish}
          </Button>
        </Card.Body>
      </Card>
    )
  }

  return (
    <Card className="mb-3 final-quest">
      <Card.Body>
        <Badge bg="dark" className="mb-2">
          {t.card.badge}
        </Badge>
        <Card.Title as="h2" className="h5">
          {t.card.title}
        </Card.Title>
        <dl className="final-quest__facts small mb-2">
          <dt>{t.card.flight}</dt>
          <dd>
            {flight?.flightNo ? `${flight.flightNo} · ` : ''}
            {hhmm(flight?.departureAt)}
          </dd>
          <dt>{t.card.arriveBy}</dt>
          <dd>
            {hhmm(safe?.arriveBy)} <span className="text-muted">({safe?.international ? t.card.international : t.card.domestic})</span>
          </dd>
          <dt>{t.card.travel}</dt>
          <dd>
            약 {safe?.travelMinutes}분{estimate}
            {safe?.congestionBufferMinutes > 0 && <span className="text-muted"> · {t.card.buffer(safe.congestionBufferMinutes)}</span>}
          </dd>
          <dt>{t.card.depart}</dt>
          <dd className="fw-bold">{hhmm(safe?.latestSafeDeparture)}</dd>
        </dl>
        {flight?.state === 'delayed' && <div className="small text-muted mb-1">{t.card.flightDelayed(flight.delayMinutes)}</div>}
        {flight?.source === 'setup' && <div className="small text-muted mb-1">{t.card.flightFallback}</div>}
        {ended > 0 && <div className="small text-muted mb-2">{t.card.ended(ended)}</div>}
        {message && <Alert variant="warning" className="small py-2">{message}</Alert>}
        {state.status === 'active' ? (
          <>
            <Button className="w-100" disabled={busy} onClick={handleStart}>
              {t.card.start}
            </Button>
            {airportMapButton}
          </>
        ) : (
          <>
            <div className="small mb-2">{t.card.moving}</div>
            <Button className="w-100" disabled={busy || locating} onClick={handleArrive}>
              {locating ? t.card.arriving : t.card.arrive}
            </Button>
            <div className="small text-muted mt-1">{t.card.arriveHint}</div>
            {airportMapButton}
          </>
        )}
      </Card.Body>
    </Card>
  )
}
