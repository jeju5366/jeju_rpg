import { useState } from 'react'
import { Button, Card, Modal } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { UI_TEXT } from '../../constants/uiText.js'
import { summarizeStyle } from '../../utils/styleProfile.js'
import StyleSummaryView from './StyleSummaryView.jsx'

// 모험가 탭의 "나의 여행 성향" 카드. preferences 로딩 실패/없음이어도 이 카드만 안내 문구로 대체되고 EXP/레벨 화면은 그대로다.
// state: 'loading' | 'error' | 'ready'
export default function StyleProfileCard({ state, preferences }) {
  const text = UI_TEXT.style
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const summary = state === 'ready' ? summarizeStyle(preferences) : null

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title as="h2" className="h6">
          {text.profileTitle}
        </Card.Title>
        {state === 'loading' && <div className="small text-muted">{text.loading}</div>}
        {state === 'error' && <div className="small text-muted">{text.loadFailed}</div>}
        {state === 'ready' && !summary && <div className="small text-muted">{text.empty}</div>}
        {summary && <StyleSummaryView summary={summary} showAll />}
        <p className="small text-muted mt-2 mb-2">{text.baseNote}</p>
        <Button size="sm" variant="outline-primary" onClick={() => setConfirming(true)}>
          {text.retake}
        </Button>
      </Card.Body>

      <Modal show={confirming} centered onHide={() => setConfirming(false)}>
        <Modal.Body>{text.retakeConfirm}</Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setConfirming(false)}>
            {text.cancel}
          </Button>
          <Button onClick={() => navigate('/style-test')}>{text.retakeGo}</Button>
        </Modal.Footer>
      </Modal>
    </Card>
  )
}
