import { useEffect, useState } from 'react'
import { Button, Card, ListGroup } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { UI_TEXT } from '../../constants/uiText.js'
import { fetchPastTrips } from '../../services/finalQuest/finalQuestService.js'

// 지난 여행 목록. Profile(모험가) 탭과 기록 탭에서 같이 쓴다. 마운트할 때 한 번만 읽는다.
export default function PastTripsPanel() {
  const t = UI_TEXT.finalQuest.past
  const [trips, setTrips] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    fetchPastTrips()
      .then((result) => active && setTrips(result.trips))
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [])

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title as="h2" className="h6">
          {t.title}
        </Card.Title>
        {error && <div className="small text-muted">{t.failed}</div>}
        {!error && trips === null && <div className="small text-muted">{t.loading}</div>}
        {trips && trips.length === 0 && <div className="small text-muted">{t.empty}</div>}
        {trips && trips.length > 0 && (
          <ListGroup variant="flush">
            {trips.map((trip) => (
              <ListGroup.Item key={trip.id} className="d-flex justify-content-between align-items-center px-0">
                <span>
                  {trip.startDate} ~ {trip.endDate} <span className="text-muted small">({UI_TEXT.finalQuest.summary.days(trip.days)})</span>
                </span>
                <Button as={Link} to={`/records/${trip.id}`} size="sm" variant="outline-primary">
                  {t.view}
                </Button>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </Card.Body>
    </Card>
  )
}
