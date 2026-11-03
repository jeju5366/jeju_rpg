import { Badge, Button, Card } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'

// 모험 1개 카드. 장소/권역/성향은 서버가 저장한 data 를 그대로 보여준다.
export default function AdventureCard({ adventure, actionLabel, onAction, disabled, busy }) {
  const text = UI_TEXT.adventure
  const { areas = [], categories = [], places = [], demo } = adventure.data ?? {}

  return (
    <Card className="h-100">
      <Card.Body className="d-flex flex-column">
        <div className="mb-2 d-flex flex-wrap gap-1">
          {demo && <Badge bg="secondary">{text.demoBadge}</Badge>}
          {areas.map((area) => (
            <Badge key={area} bg="info" text="dark">
              {area}
            </Badge>
          ))}
          {categories.map((category) => (
            <Badge key={category} bg="success">
              {UI_TEXT.categories[category] ?? category}
            </Badge>
          ))}
        </div>
        <Card.Title as="h2" className="h5">
          {adventure.title}
        </Card.Title>
        <Card.Text>{adventure.summary}</Card.Text>
        <div className="small text-muted mb-3">
          <strong>{text.places}</strong>
          <ul className="mb-0 ps-3">
            {places.map((place) => (
              <li key={place.placeId}>{place.name}</li>
            ))}
          </ul>
        </div>
        <Button className="mt-auto" disabled={disabled} onClick={onAction}>
          {busy ? text.selecting : actionLabel}
        </Button>
      </Card.Body>
    </Card>
  )
}