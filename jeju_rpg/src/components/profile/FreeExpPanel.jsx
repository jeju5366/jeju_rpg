import { useState } from 'react'
import { Alert, Button, Card, Form, ListGroup } from 'react-bootstrap'
import { FREE_EXP_INVEST_CATEGORIES } from '../../constants/gameBalance.js'
import { UI_TEXT } from '../../constants/uiText.js'

// 자유 EXP 한 덩어리를 카테고리 하나에 전부 투자한다. (분할 불가, 되돌릴 수 없어서 한 번 더 확인)
export default function FreeExpPanel({ grants, investingId, onInvest }) {
  const text = UI_TEXT.progression.profile
  const [picked, setPicked] = useState({}) // grantId → category

  const handleInvest = (grant) => {
    const category = picked[grant.id]
    if (!category) return
    const label = UI_TEXT.categories[category]
    // eslint-disable-next-line no-alert
    if (window.confirm(`${label}: ${grant.amount} EXP\n${text.confirmInvest}`)) onInvest(grant, category)
  }

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title as="h2" className="h6">
          {text.freeExp}
        </Card.Title>
        <Card.Text className="small text-muted">{text.freeExpDesc}</Card.Text>
        {grants.length === 0 ? (
          <Alert variant="light" className="mb-0 small">
            {text.noFreeExp}
          </Alert>
        ) : (
          <ListGroup variant="flush">
            {grants.map((grant) => (
              <ListGroup.Item key={grant.id} className="d-flex flex-wrap align-items-center gap-2">
                <span className="me-auto">
                  {text.sources[grant.source_type] ?? grant.source_type} <strong>+{grant.amount}</strong>
                </span>
                <Form.Select
                  size="sm"
                  style={{ width: 130 }}
                  aria-label={text.chooseCategory}
                  value={picked[grant.id] ?? ''}
                  disabled={investingId !== null}
                  onChange={(e) => setPicked((prev) => ({ ...prev, [grant.id]: e.target.value }))}
                >
                  <option value="">{text.chooseCategory}</option>
                  {FREE_EXP_INVEST_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {UI_TEXT.categories[category]}
                    </option>
                  ))}
                </Form.Select>
                <Button size="sm" disabled={!picked[grant.id] || investingId !== null} onClick={() => handleInvest(grant)}>
                  {investingId === grant.id ? text.investing : text.invest}
                </Button>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </Card.Body>
    </Card>
  )
}