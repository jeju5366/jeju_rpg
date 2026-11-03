import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import FreeTravelPanel from '../components/freeTravel/FreeTravelPanel.jsx'
import FreeTravelReturn from '../components/freeTravel/FreeTravelReturn.jsx'
import FreeTravelReview from '../components/freeTravel/FreeTravelReview.jsx'
import FreeTravelStartButton from '../components/freeTravel/FreeTravelStartButton.jsx'
import { buildMapMarkers } from '../components/map/buildMarkers.js'
import { MARKER_KINDS, MARKER_LEGEND } from '../components/map/markerConfig.js'
import NaverMapView from '../components/map/NaverMapView.jsx'
import { CACHE_RULES } from '../constants/replanRules.js'
import { UI_TEXT } from '../constants/uiText.js'
import useGeolocation from '../hooks/useGeolocation.js'
import useQuestBoard from '../hooks/useQuestBoard.js'
import { fetchVisitedPlaces } from '../services/freeTravel/freeTravelService.js'
import { queryPermission } from '../services/location/geolocation.js'
import { useAdventureStore } from '../store/adventureStore.js'
import { useMapFocusStore } from '../store/mapFocusStore.js'
import { useFreeTravelStore } from '../store/freeTravelStore.js'

// 지도: 현재 위치 / 현재 챕터 목적지 / 이후 주요 장소 / (자유여행 중) 주변 장소·방문 후보 / 방문한 장소.
// 위치 권한은 "내 위치 확인"을 누르거나 자유여행을 시작할 때만 요청한다. (이 화면이 열렸다고 묻지 않는다)
// 지도(NAVER)나 위치가 실패해도 이 화면의 다른 정보와 앱의 나머지는 그대로 쓸 수 있다.
//
// 탭 전환 최적화
//   · 전체 화면 spinner 없음: 퀘스트 판/방문한 장소는 store 캐시를 즉시 쓰고 오래됐을 때만 백그라운드로 다시 읽는다.
//   · 지도 인스턴스는 NaverMapView 가 보관해서 재사용한다. (스크립트 재로드/지도 재생성/마커 재구성 없음)
//   · 위치는 마지막으로 알던 값을 먼저 쓰고, 권한이 "이미 허용된" 경우에만 조용히 새 위치를 받아 마커만 갱신한다. (권한 창을 띄우지 않는다)
const NO_VISITED = []

export default function MapPage() {
  const text = UI_TEXT.map
  const phase = useFreeTravelStore((s) => s.phase)
  const nearbyPlaces = useFreeTravelStore((s) => s.nearby.places)
  const candidatesMap = useFreeTravelStore((s) => s.tracking.candidates)
  const route = useFreeTravelStore((s) => s.tracking.route)
  const { position, loading, error, locate } = useGeolocation({ checkPermission: true })
  const { trip, adventure, chapters, quests, refreshing, error: loadError } = useQuestBoard()
  const visitedState = useAdventureStore()
  const returning = phase === 'returning'
  // 퀘스트/Final Quest 에서 "지도에서 보기"로 넘어온 대상. 한 번만 읽고 비운다(일반 진입이면 null → 기존 전체 지도 동작 그대로).
  const [pin] = useState(() => useMapFocusStore.getState().target)
  const [focus, setFocus] = useState(() => (pin ? { lat: pin.lat, lng: pin.lng, key: pin.key } : null))
  useEffect(() => {
    useMapFocusStore.getState().consume()
  }, [])

  // 방문한 장소(마커용): 캐시가 신선하면 다시 읽지 않는다. 자유여행 복귀(방문 저장) 뒤에는 새로 읽는다.
  const tripId = trip?.id
  const visited = visitedState.visitedTripId === tripId ? visitedState.visited : NO_VISITED
  useEffect(() => {
    if (!tripId) return
    const state = useAdventureStore.getState()
    const fresh = state.visitedTripId === tripId && Date.now() - state.visitedLoadedAt < CACHE_RULES.visitedStaleMs
    if (fresh) return
    fetchVisitedPlaces(tripId)
      .then((rows) => useAdventureStore.getState().setVisited(tripId, rows))
      .catch(() => {}) // 008 미적용 등으로 실패해도 지도는 그대로
  }, [tripId, returning])

  // 마지막 위치가 오래됐으면, 위치 권한이 이미 허용된 경우에만 조용히 새로 받는다 (마커만 갱신, 화면을 막지 않는다)
  useEffect(() => {
    let active = true
    const last = position?.timestamp ?? 0
    if (last && Date.now() - last < CACHE_RULES.locationStaleMs) return undefined
    queryPermission().then((state) => active && state === 'granted' && locate())
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markers = useMemo(
    () =>
      buildMapMarkers({
        position,
        chapters,
        quests,
        visited,
        nearbyPlaces: phase === 'active' ? nearbyPlaces : [],
        candidates: phase === 'active' ? Object.values(candidatesMap) : [],
      }).concat(pin ? [{ id: 'target', kind: 'target', lat: pin.lat, lng: pin.lng, title: pin.title }] : []),
    [position, chapters, quests, visited, phase, nearbyPlaces, candidatesMap, pin],
  )
  const path = useMemo(() => (phase === 'active' || phase === 'reviewing' ? route : []), [phase, route])

  const handleLocate = async () => {
    const result = await locate()
    if (result.ok) setFocus({ lat: result.position.lat, lng: result.position.lng, key: Date.now() })
  }

  const adventureActive = adventure?.status === 'active'

  return (
    <>
      <h1 className="h4 mb-3">{UI_TEXT.pages.map.title}</h1>
      {loadError && <Alert variant="danger">{loadError}</Alert>}
      {refreshing && !chapters.length && (
        <div className="small text-muted mb-2">
          <Spinner animation="border" size="sm" /> {UI_TEXT.map.loading}
        </div>
      )}
      {!adventureActive && phase === 'idle' && (
        <Alert variant="light" className="small">
          {text.noAdventure} <Link to="/adventure">{UI_TEXT.quest.goAdventure}</Link>
        </Alert>
      )}

      <NaverMapView markers={markers} path={path} focus={focus} height={340} />

      <div className="d-flex flex-wrap gap-1 mb-2">
        {MARKER_LEGEND.map((kind) => (
          <Badge key={kind} bg="light" text="dark" className="border">
            <span style={{ color: MARKER_KINDS[kind].color }}>●</span> {text.legend[kind]}
          </Badge>
        ))}
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <Button size="sm" variant="outline-primary" disabled={loading} onClick={handleLocate}>
          📍 {loading ? text.locating : text.myLocation}
        </Button>
        {position && (
          <span className="small text-muted">
            {text.accuracy} {Math.round(position.accuracy)}
            {text.meter}
          </span>
        )}
        {adventureActive && phase === 'idle' && <FreeTravelStartButton adventureId={adventure.id} variant="outline-info" />}
      </div>
      {error && (
        <Alert variant="warning" className="small py-2">
          {UI_TEXT.location.errors[error] ?? UI_TEXT.location.errors.position_unavailable}
        </Alert>
      )}

      {phase === 'active' && <FreeTravelPanel />}
      {phase === 'reviewing' && <FreeTravelReview />}
      {phase === 'returning' && <FreeTravelReturn />}
    </>
  )
}
