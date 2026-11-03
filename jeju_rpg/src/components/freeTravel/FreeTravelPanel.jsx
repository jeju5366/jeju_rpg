import { useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, ListGroup, Modal } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { useFreeTravelActions } from '../../hooks/useFreeTravel.js'
import { useFreeTravelStore } from '../../store/freeTravelStore.js'
import { useLocationStore } from '../../store/locationStore.js'
import { isMeaningfulPlace } from '../../utils/freeTravel/tracker.js'
import { haversineMeters } from '../../utils/geo.js'

const NEARBY_LIST_LIMIT = 8

// 자유여행 중 지도 아래에 보이는 패널: "자유여행 중" 표시, 주변 주요 장소, 이동 기록 상태, "자유여행 종료".
// 자유여행은 퀘스트 모드가 아니라서 방문을 권하거나 GPT 로 추천하지 않는다. (주변 장소는 TourAPI 조회 결과를 거리순으로 보여줄 뿐)
// 방문 후보가 감지돼도 여기서는 팝업을 띄우지 않는다. 종료 후 한꺼번에 확인한다.
export default function FreeTravelPanel() {
  const text = UI_TEXT.free
  const { tracking, nearby, trackError, notice, dismissNotice } = useFreeTravelStore()
  const position = useLocationStore((s) => s.position)
  const { beginReview } = useFreeTravelActions()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const nearbyList = useMemo(() => {
    const places = nearby.places.filter(isMeaningfulPlace)
    if (!position) return places.slice(0, NEARBY_LIST_LIMIT).map((place) => ({ place, distance: null }))
    return places
      .map((place) => ({ place, distance: haversineMeters(position, place) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEARBY_LIST_LIMIT)
  }, [nearby.places, position])

  const candidateCount = Object.keys(tracking.candidates).length

  return (
    <>
      <Card className="mb-3 border-info">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <Card.Title as="h2" className="h5 mb-0">
              🧭 {text.banner}
            </Card.Title>
            <Badge bg="info">
              {text.routeInfo} {tracking.route.length}
              {text.points}
            </Badge>
          </div>
          <div className="small text-muted mb-2">{text.bannerDesc}</div>

          {trackError && (
            <Alert variant="warning" className="small py-2">
              {text.trackErrors[trackError] ?? text.trackErrors.position_unavailable}
            </Alert>
          )}
          {notice === 'gap' && (
            <Alert variant="secondary" dismissible onClose={dismissNotice} className="small py-2">
              {text.gapNotice}
            </Alert>
          )}

          <div className="fw-bold small mb-1">{text.nearby}</div>
          {nearbyList.length === 0 ? (
            <div className="small text-muted mb-2">{text.nearbyEmpty}</div>
          ) : (
            <ListGroup variant="flush" className="small mb-2">
              {nearbyList.map(({ place, distance }) => (
                <ListGroup.Item key={place.placeId} className="d-flex justify-content-between px-0 py-1">
                  <span>{place.name}</span>
                  {distance !== null && <span className="text-muted">{distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${distance}m`}</span>}
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
          <div className="small text-muted mb-3">
            {text.nearbyHint} {candidateCount > 0 && text.candidatesQuiet}
          </div>

          <Button variant="outline-danger" className="w-100" onClick={() => setConfirmOpen(true)}>
            {text.end}
          </Button>
        </Card.Body>
      </Card>

      {/* 종료 확인 모달: 실수로 눌러도 바로 끝나지 않는다. 확인해야 방문 후보 확인 단계로 간다. */}
      <Modal show={confirmOpen} onHide={() => setConfirmOpen(false)} centered>
        <Modal.Header>
          <Modal.Title as="h2" className="h5">
            {text.endModal.title}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {text.endModal.lines.map((line) => (
            <p key={line} className="mb-0">
              {line}
            </p>
          ))}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setConfirmOpen(false)}>
            {text.endModal.stay}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(false)
              beginReview()
            }}
          >
            {text.endModal.confirm}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
