import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, ListGroup, Spinner } from 'react-bootstrap'
import { JEJU_CITY } from '../../constants/jeju.js'
import { MANUAL_VISIT_SEARCH_RADIUS_METERS } from '../../constants/locationRules.js'
import { UI_TEXT } from '../../constants/uiText.js'
import { fetchNearbyPlaces } from '../../services/tour/tourService.js'
import { judgeManualVisit } from '../../utils/freeTravel/routeAnalysis.js'
import { isMeaningfulPlace } from '../../utils/freeTravel/tracker.js'

// 수동 방문 기록: GPS 가 놓친 장소를 직접 추가한다.
// 후보는 "자유여행 이동 경로 주변"(처음/중간/끝 지점 근처)의 TourAPI 장소다. 현재 위치 하나만 기준으로 하지 않는다.
// 추가 가능 여부는 judgeManualVisit 가 이동 경로 전체를 기준으로 판단한다. (서버도 같은 함수로 다시 확인한다)
//   경로 근처 → 추가 가능 / 경로에서 터무니없이 멂 → 추가 불가 / 경로가 부족(GPS 근거 없음) → 추가 가능하지만 발견 EXP 없음
// 장소 검색 API 는 열 때 한 번(최대 3곳)만 부르고, 이름 필터는 가져온 목록 안에서만 한다.
function searchCenters(route, position) {
  if (route.length >= 3) return [route[0], route[Math.floor(route.length / 2)], route[route.length - 1]]
  if (route.length > 0) return [route[route.length - 1]]
  return [position ?? JEJU_CITY]
}

export default function ManualVisitPicker({ route, position, takenIds, onPick, onClose }) {
  const text = UI_TEXT.free.review
  const [places, setPlaces] = useState(null) // null = 불러오는 중
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    const centers = searchCenters(route, position)
    Promise.all(centers.map((c) => fetchNearbyPlaces({ lat: c.lat, lng: c.lng, radius: MANUAL_VISIT_SEARCH_RADIUS_METERS, limit: 50 })))
      .then((responses) => {
        if (!active) return
        const byId = new Map()
        for (const response of responses) for (const place of response.data ?? []) if (isMeaningfulPlace(place)) byId.set(place.placeId, place)
        setPlaces([...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
      })
      .catch(() => active && (setFailed(true), setPlaces([])))
    return () => {
      active = false
    }
  }, [route, position])

  const items = useMemo(() => {
    const q = query.trim()
    return (places ?? [])
      .filter((p) => !q || p.name.includes(q))
      .map((place) => ({ place, judge: judgeManualVisit(place, route) }))
  }, [places, query, route])

  return (
    <div className="border rounded p-2 mb-3">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <div className="fw-bold">{text.addTitle}</div>
        <Button size="sm" variant="outline-secondary" onClick={onClose}>
          {text.close}
        </Button>
      </div>
      <div className="small text-muted mb-2">{text.addDesc}</div>
      <Form.Control size="sm" className="mb-2" placeholder={text.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      {places === null && (
        <div className="small text-muted">
          <Spinner animation="border" size="sm" /> {text.searching}
        </div>
      )}
      {failed && (
        <Alert variant="warning" className="small py-1">
          {text.searchFailed}
        </Alert>
      )}
      {places !== null && items.length === 0 && !failed && <div className="small text-muted">{text.searchEmpty}</div>}
      <ListGroup className="small" style={{ maxHeight: 240, overflowY: 'auto' }}>
        {items.map(({ place, judge }) => {
          const taken = takenIds.has(place.placeId)
          const blocked = !judge.ok
          return (
            <ListGroup.Item key={place.placeId} className="d-flex justify-content-between align-items-center gap-2 py-1">
              <div className="flex-grow-1">
                <div>{place.name}</div>
                <div className="text-muted">{blocked ? text.tooFar : place.address}</div>
              </div>
              <Button size="sm" variant="outline-primary" disabled={taken || blocked} onClick={() => onPick(place)}>
                {text.pick}
              </Button>
            </ListGroup.Item>
          )
        })}
      </ListGroup>
    </div>
  )
}
