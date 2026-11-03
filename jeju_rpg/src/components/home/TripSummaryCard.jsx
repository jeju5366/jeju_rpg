import { Alert, Button, Card, ListGroup } from 'react-bootstrap'
import { COMPANIONS, TRANSPORTS } from '../../constants/onboarding.js'
import { UI_TEXT } from '../../constants/uiText.js'
import { accommodationForDate } from '../../utils/dailyContext.js'
import { formatKstDateTime, formatMonthDay } from '../../utils/time.js'

const labelOf = (list, id) => list.find((item) => item.id === id)?.label ?? id

function Row({ label, children }) {
  return (
    <ListGroup.Item className="d-flex justify-content-between gap-3 px-0">
      <span className="text-muted">{label}</span>
      <span className="text-end fw-semibold">{children}</span>
    </ListGroup.Item>
  )
}

// 이번 여행 요약 카드. 여행 전체 정보(기간/숙소/항공편)와 오늘 조건(동행/이동수단/종료 희망)을 나눠서 보여준다.
export default function TripSummaryCard({ trip, date, daily, onEditTrip, onEditDaily }) {
  const text = UI_TEXT.home
  const { today, isChangeDay } = accommodationForDate(trip.accommodations ?? [], date)
  const flightParts = [trip.departure_flight, trip.departure_datetime ? formatKstDateTime(trip.departure_datetime) : null].filter(Boolean)
  const values = daily?.values

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title as="h1" className="h5">
          {text.tripTitle}
        </Card.Title>

        <div className="small text-muted mt-3">{text.sectionTrip}</div>
        <ListGroup variant="flush" className="mb-2">
          <Row label={text.period}>
            {formatMonthDay(trip.start_date)} ~ {formatMonthDay(trip.end_date)}
          </Row>
          <Row label={text.accommodation}>
            {today ? (
              <>
                {today.name}
                {today.address && <div className="small text-muted fw-normal">{today.address}</div>}
                {isChangeDay && <div className="small text-warning fw-normal">{text.accommodationChange}</div>}
              </>
            ) : (
              text.notSet
            )}
          </Row>
          <Row label={text.departure}>{flightParts.length ? flightParts.join(' / ') : text.notSet}</Row>
        </ListGroup>
        <Button size="sm" variant="outline-secondary" onClick={onEditTrip}>
          {text.editTrip}
        </Button>

        <div className="small text-muted mt-4">
          {text.sectionToday} ({formatMonthDay(date)})
        </div>
        {values && (
          <>
            <ListGroup variant="flush" className="mb-2">
              <Row label={text.companion}>
                {labelOf(COMPANIONS, values.companion)}
                {Number(values.party_size) > 1 ? ` (${values.party_size}${text.people})` : ''}
              </Row>
              <Row label={text.transport}>{labelOf(TRANSPORTS, values.transport)}</Row>
              <Row label={text.desiredEnd}>{values.desired_end_time ?? text.noEndTime}</Row>
            </ListGroup>
            {!daily.confirmed && (
              <Alert variant="light" className="small py-2">
                {daily.source === 'previous' ? text.unconfirmedPrevious : text.unconfirmedTrip}
              </Alert>
            )}
            <Button size="sm" variant="outline-secondary" onClick={onEditDaily}>
              {text.editDaily}
            </Button>
          </>
        )}
      </Card.Body>
    </Card>
  )
}