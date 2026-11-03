import { useEffect, useState } from 'react'
import { Accordion, Alert, Button, Spinner } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import MemoryThumbs from '../components/records/MemoryThumbs.jsx'
import { UI_TEXT } from '../constants/uiText.js'
import { fetchTripRecord } from '../services/finalQuest/finalQuestService.js'

// 여행 상세 기록: 요약에 다 못 담은 내용(퀘스트 종류별 수 / 방문·발견 장소 / 카테고리별 EXP·레벨 / 사진 전체 / 재조정·돌발 기록 / 피드백)을 접이식으로 보여준다.
export default function TripRecordPage() {
  const t = UI_TEXT.finalQuest
  const r = t.record
  const { tripId } = useParams()
  const [record, setRecord] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    fetchTripRecord(tripId)
      .then((result) => active && setRecord(result.record))
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [tripId])

  if (error) return <Alert variant="danger">{t.summary.failed}</Alert>
  if (!record) {
    return (
      <div className="small text-muted py-3">
        <Spinner animation="border" size="sm" /> {t.summary.loading}
      </div>
    )
  }
  const { trip, stats, exp, places, discoveries, photos, titles, feedback, replanLog, surpriseLog } = record
  const list = (items, render) => (items.length ? <ul className="mb-0 ps-3">{items.map(render)}</ul> : <div className="small text-muted">{r.none}</div>)

  return (
    <div className="trip-record">
      <h1 className="h4 mb-1">{r.title}</h1>
      <div className="text-muted small mb-3">
        {trip.startDate} ~ {trip.endDate} ({t.summary.days(trip.days)})
      </div>
      {trip.retrospective && <p className="small">{trip.retrospective}</p>}

      <Accordion defaultActiveKey={['stats']} alwaysOpen className="mb-3">
        <Accordion.Item eventKey="stats">
          <Accordion.Header>{r.stats}</Accordion.Header>
          <Accordion.Body className="small">
            <div>
              {r.quests}: {r.core} {stats.core} · {r.optional} {stats.optional} · {r.surprise} {stats.surprise} (합 {stats.completedQuests})
            </div>
            {stats.endedByFinalQuest > 0 && (
              <div className="text-muted">
                {r.endedByFinal}: {stats.endedByFinalQuest}
              </div>
            )}
            <div>
              {r.visited}: {stats.visitedPlaces} · {t.summary.discoveries}: {stats.discoveries} · {t.summary.totalExp}: {stats.totalExp} EXP
            </div>
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="exp">
          <Accordion.Header>{r.exp}</Accordion.Header>
          <Accordion.Body className="small">
            {list(exp.levelChanges, (c) => (
              <li key={c.category}>
                {UI_TEXT.categories[c.category] ?? c.category} +{c.gained} EXP ({r.levelChange(c.from, c.to)})
              </li>
            ))}
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="places">
          <Accordion.Header>
            {r.places} ({places.length})
          </Accordion.Header>
          <Accordion.Body className="small">
            {list(places, (p, i) => (
              <li key={`${p.placeId}-${i}`}>{p.name ?? p.placeId}</li>
            ))}
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="discoveries">
          <Accordion.Header>
            {r.discoveries} ({discoveries.length})
          </Accordion.Header>
          <Accordion.Body className="small">
            {list(discoveries, (d) => (
              <li key={d.placeId}>{d.name ?? d.placeId}</li>
            ))}
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="photos">
          <Accordion.Header>
            {r.photos} ({photos.length})
          </Accordion.Header>
          <Accordion.Body>{photos.length ? <MemoryThumbs photos={photos} limit={50} /> : <div className="small text-muted">{t.summary.noMemories}</div>}</Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="titles">
          <Accordion.Header>{t.summary.titles}</Accordion.Header>
          <Accordion.Body className="small">
            {list(titles, (title) => (
              <li key={title.code}>🏅 {title.name}</li>
            ))}
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="log">
          <Accordion.Header>
            {r.replan} / {r.surpriseLog}
          </Accordion.Header>
          <Accordion.Body className="small">
            <div>
              {r.replan}: {replanLog.length}회
            </div>
            <div>
              {r.surpriseLog}: {r.surpriseCounts(surpriseLog.accepted, surpriseLog.declined)}
            </div>
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="feedback">
          <Accordion.Header>{r.feedback}</Accordion.Header>
          <Accordion.Body className="small">
            {feedback ? (
              <>
                <div>
                  ★ {feedback.rating ?? '-'} · {t.feedback.densities[feedback.density] ?? '-'} · {t.feedback.placesOptions[feedback.placesRating] ?? '-'} · {t.feedback.difficulties[feedback.difficulty] ?? '-'}
                </div>
                {feedback.comment && <div className="text-muted">“{feedback.comment}”</div>}
              </>
            ) : (
              <div className="text-muted">{r.none}</div>
            )}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>

      <div className="d-flex gap-2 mb-3">
        <Button as={Link} to="/records" variant="outline-secondary" className="flex-fill">
          {r.back}
        </Button>
        <Button as={Link} to={`/summary/${trip.id}`} variant="outline-primary" className="flex-fill">
          {t.summary.title}
        </Button>
      </div>
    </div>
  )
}
