import { useEffect, useState } from 'react'
import { Alert, Button, Card, Spinner } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import FeedbackForm from '../components/records/FeedbackForm.jsx'
import MemoryThumbs from '../components/records/MemoryThumbs.jsx'
import { UI_TEXT } from '../constants/uiText.js'
import { fetchTripRecord } from '../services/finalQuest/finalQuestService.js'

function Stat({ label, children }) {
  return (
    <div className="trip-summary__stat">
      <div className="small text-muted">{label}</div>
      <div className="fw-bold">{children}</div>
    </div>
  )
}

// Trip Summary: 모바일에서 한 화면에 들어오는 짧은 요약. 모든 기록은 상세 화면(/records/:tripId)에서 본다.
export default function TripSummaryPage() {
  const t = UI_TEXT.finalQuest.summary
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

  if (error) return <Alert variant="danger">{t.failed}</Alert>
  if (!record) {
    return (
      <div className="small text-muted py-3">
        <Spinner animation="border" size="sm" /> {t.loading}
      </div>
    )
  }
  const { trip, stats, photos, titles } = record

  return (
    <div className="trip-summary">
      <h1 className="h4 mb-1">🎉 {t.title}</h1>
      <div className="text-muted small mb-3">
        {trip.startDate} ~ {trip.endDate} ({t.days(trip.days)})
      </div>

      <Card className="mb-3">
        <Card.Body className="trip-summary__stats">
          <Stat label={t.completed}>{t.count(stats.completedQuests)}</Stat>
          <Stat label={t.discoveries}>{t.placeCount(stats.discoveries)}</Stat>
          <Stat label={t.totalExp}>{stats.totalExp} EXP</Stat>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body>
          <Card.Title as="h2" className="h6">
            {t.memories}
          </Card.Title>
          {photos.length ? <MemoryThumbs photos={photos} limit={4} /> : <div className="small text-muted">{t.noMemories}</div>}
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body>
          <Card.Title as="h2" className="h6">
            {t.titles}
          </Card.Title>
          {titles.length ? (
            <div className="d-flex flex-wrap gap-2">
              {titles.map((title) => (
                <span key={title.code} className="badge text-bg-warning">
                  🏅 {title.name}
                </span>
              ))}
            </div>
          ) : (
            <div className="small text-muted">{t.noTitles}</div>
          )}
        </Card.Body>
      </Card>

      {trip.retrospective && (
        <Card className="mb-3">
          <Card.Body>
            <Card.Title as="h2" className="h6">
              {t.retro}
            </Card.Title>
            <Card.Text className="mb-0">{trip.retrospective}</Card.Text>
          </Card.Body>
        </Card>
      )}

      <Card className="mb-3">
        <Card.Body>
          <Card.Title as="h2" className="h6">
            {t.feedbackTitle}
          </Card.Title>
          <FeedbackForm tripId={trip.id} initial={record.feedback} />
        </Card.Body>
      </Card>

      <div className="d-flex gap-2 mb-3">
        <Button as={Link} to={`/records/${trip.id}`} variant="outline-primary" className="flex-fill">
          {t.detail}
        </Button>
        <Button as={Link} to="/" variant="primary" className="flex-fill">
          {t.home}
        </Button>
      </div>
    </div>
  )
}
