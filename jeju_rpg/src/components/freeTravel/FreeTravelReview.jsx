import { useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Form, ListGroup } from 'react-bootstrap'
import { MANUAL_VISIT_MIN_ROUTE_POINTS } from '../../constants/locationRules.js'
import { UI_TEXT } from '../../constants/uiText.js'
import { useFreeTravelActions } from '../../hooks/useFreeTravel.js'
import { useFreeTravelStore } from '../../store/freeTravelStore.js'
import { useLocationStore } from '../../store/locationStore.js'
import ManualVisitPicker from './ManualVisitPicker.jsx'

// 자유여행 종료를 확정한 뒤, 그동안 모은 방문 후보를 한꺼번에 보여주고 실제로 간 곳만 체크하게 한다.
// GPS 감지 = 방문 "후보"일 뿐이다. 사용자가 체크해서 저장한 장소만 방문으로 확정된다. (서버가 경로로 한 번 더 검증)
export default function FreeTravelReview() {
  const text = UI_TEXT.free.review
  const { tracking, selected, manualVisits, toggleSelected, addManualVisit, removeManualVisit, resumeFromReview } = useFreeTravelStore()
  const position = useLocationStore((s) => s.position)
  const { finish } = useFreeTravelActions()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const candidates = useMemo(() => Object.values(tracking.candidates).sort((a, b) => a.sinceT - b.sinceT), [tracking.candidates])
  const takenIds = useMemo(() => new Set([...candidates.map((c) => c.placeId), ...manualVisits.map((m) => m.placeId)]), [candidates, manualVisits])
  const selectedCount = [...candidates, ...manualVisits].filter((v) => selected[v.placeId]).length
  const weakRoute = tracking.route.length < MANUAL_VISIT_MIN_ROUTE_POINTS
  const hasSelectedManual = manualVisits.some((m) => selected[m.placeId])

  const save = async (skipVisits) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await finish({ skipVisits })
    } catch (err) {
      setError(UI_TEXT.free.errors[err.code] ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-3 border-info">
      <Card.Body>
        <Card.Title as="h2" className="h5">
          {text.title}
        </Card.Title>
        <div className="small text-muted mb-2">{text.desc}</div>

        {candidates.length === 0 && manualVisits.length === 0 && <div className="small text-muted mb-2">{text.empty}</div>}

        <ListGroup className="mb-2">
          {candidates.map((c) => (
            <ListGroup.Item key={c.placeId}>
              <Form.Check
                id={`visit-${c.placeId}`}
                type="checkbox"
                checked={Boolean(selected[c.placeId])}
                onChange={() => toggleSelected(c.placeId)}
                label={
                  <span>
                    {c.name} <span className="small text-muted">· {c.dwellMinutes}{text.dwell}</span>
                  </span>
                }
              />
            </ListGroup.Item>
          ))}
          {manualVisits.map((m) => (
            <ListGroup.Item key={m.placeId} className="d-flex justify-content-between align-items-center">
              <Form.Check
                id={`visit-${m.placeId}`}
                type="checkbox"
                checked={Boolean(selected[m.placeId])}
                onChange={() => toggleSelected(m.placeId)}
                label={
                  <span>
                    {m.name}{' '}
                    <Badge bg="secondary" className="ms-1">
                      {text.manualTag}
                    </Badge>
                  </span>
                }
              />
              <Button size="sm" variant="link" onClick={() => removeManualVisit(m.placeId)}>
                {text.remove}
              </Button>
            </ListGroup.Item>
          ))}
        </ListGroup>

        {weakRoute && hasSelectedManual && (
          <Alert variant="warning" className="small py-2">
            {text.noRouteWarn}
          </Alert>
        )}

        {adding ? (
          <ManualVisitPicker
            route={tracking.route}
            position={position}
            takenIds={takenIds}
            onPick={(place) => addManualVisit({ placeId: place.placeId, name: place.name, lat: place.lat, lng: place.lng, contentTypeId: place.contentTypeId })}
            onClose={() => setAdding(false)}
          />
        ) : (
          <Button size="sm" variant="outline-primary" className="mb-3" disabled={busy} onClick={() => setAdding(true)}>
            + {text.add}
          </Button>
        )}

        {error && (
          <Alert variant="danger" className="small py-2">
            {error}
          </Alert>
        )}

        <div className="d-grid gap-2">
          <Button disabled={busy || selectedCount === 0} onClick={() => save(false)}>
            {busy ? text.saving : `${text.save} (${selectedCount}${text.selectedCount})`}
          </Button>
          <Button variant="outline-secondary" disabled={busy} onClick={() => save(true)}>
            {text.saveNone}
          </Button>
          <Button variant="link" disabled={busy} onClick={resumeFromReview}>
            {text.back}
          </Button>
        </div>
      </Card.Body>
    </Card>
  )
}
