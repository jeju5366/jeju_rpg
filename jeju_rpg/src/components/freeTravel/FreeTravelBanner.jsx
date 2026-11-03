import { Alert, Button } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { UI_TEXT } from '../../constants/uiText.js'
import { useFreeTravelStore } from '../../store/freeTravelStore.js'

// 자유여행 중(또는 종료 확인 중)임을 다른 화면(퀘스트)에서 알려준다. 모험 진행 정보는 그대로 보관돼 있다.
export default function FreeTravelBanner() {
  const text = UI_TEXT.free
  const phase = useFreeTravelStore((s) => s.phase)
  if (phase !== 'active' && phase !== 'reviewing') return null
  return (
    <Alert variant="info" className="d-flex justify-content-between align-items-center gap-2">
      <div>
        <div className="fw-bold">🧭 {text.banner}</div>
        <div className="small">{text.bannerDesc}</div>
      </div>
      <Button as={Link} to="/map" size="sm" variant="info">
        {text.goMap}
      </Button>
    </Alert>
  )
}
