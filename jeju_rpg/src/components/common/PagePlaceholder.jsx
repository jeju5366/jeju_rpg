import { Badge, Card } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'

export default function PagePlaceholder({ title, desc, children }) {
  return (
    <Card className="page-placeholder">
      <Card.Body>
        <Badge bg="secondary" className="mb-2">
          {UI_TEXT.placeholderBadge}
        </Badge>
        <Card.Title as="h1" className="h4">
          {title}
        </Card.Title>
        {desc && <Card.Text>{desc}</Card.Text>}
        {children}
      </Card.Body>
    </Card>
  )
}
