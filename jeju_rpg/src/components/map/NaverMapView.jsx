import { useEffect, useRef, useState } from 'react'
import { Alert, ListGroup } from 'react-bootstrap'
import { JEJU_CITY } from '../../constants/jeju.js'
import { UI_TEXT } from '../../constants/uiText.js'
import { loadNaverMaps } from '../../services/naver/mapLoader.js'
import { MARKER_KINDS, markerHtml } from './markerConfig.js'

// NAVER Dynamic Map 표시 전용 컴포넌트. "무엇을 어디에 표시할지"(markers/path)만 받고, 모양은 markerConfig 가 정한다.
//  markers: [{ id, kind, lat, lng, title }]   path: [{ lat, lng }] (자유여행 경로 선, 선택)
//  focus  : { lat, lng, key } — key 가 바뀔 때마다 그 위치로 이동한다.
// 지도를 쓸 수 없으면(키 없음/인증 실패/로드 실패) 같은 정보를 목록으로 보여주고 나머지 화면은 그대로 쓸 수 있게 한다.
//
// 탭 전환 최적화: 지도 인스턴스(와 마커/경로 선, 중심/확대 상태)는 모듈 수준에 "한 번만" 만들어 두고,
//   지도 탭을 나갈 때는 DOM 에서 떼어 놓기만(파괴 X), 돌아오면 같은 인스턴스를 다시 붙인다.
//   → SDK 스크립트 재로드 없음 / 지도 재생성 없음 / 마커 재구성 없음 / 이전 지도 상태가 즉시 보인다.
const DEFAULT_ZOOM = 11
const FOCUS_ZOOM = 15

const host = {
  node: null, // 지도가 그려진 div. 페이지를 오가도 유지된다
  map: null,
  markers: new Map(), // id → { marker, signature }
  line: null,
  fitted: false, // 처음 한 번만 전체가 보이게 맞춘다 (돌아왔을 때 사용자의 보기 상태를 유지)
  stats: { created: 0, attached: 0 }, // 재사용 확인용
}

async function ensureMap() {
  const maps = await loadNaverMaps() // 이미 불러왔다면 같은 Promise/객체를 그대로 돌려준다 (스크립트는 한 번만 로드)
  if (!host.map) {
    host.node = document.createElement('div')
    host.node.style.cssText = 'width:100%;height:100%'
    host.map = new maps.Map(host.node, {
      center: new maps.LatLng(JEJU_CITY.lat, JEJU_CITY.lng),
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      zoomControlOptions: { position: maps.Position.TOP_RIGHT },
    })
    host.stats.created += 1
  }
  return maps
}

// 보관 중인 지도를 새 컨테이너에 붙이고 크기를 다시 맞춘다
function attach(container) {
  if (host.node.parentNode !== container) container.appendChild(host.node)
  host.stats.attached += 1
  const maps = window.naver?.maps
  try {
    maps?.Event.trigger(host.map, 'resize')
    host.map.refresh?.(true)
  } catch {
    /* 크기 갱신에 실패해도 지도는 그대로 보인다 */
  }
}

if (typeof window !== 'undefined') window.__naverMapHost = host // 개발 중 재사용 여부 확인용

export default function NaverMapView({ markers, path = [], focus = null, height = 320 }) {
  const text = UI_TEXT.map
  const containerRef = useRef(null)
  const [state, setState] = useState(() => (host.map ? { status: 'ready', error: null } : { status: 'loading', error: null }))

  // 지도 준비 + 붙이기 / 떼기
  useEffect(() => {
    let active = true
    const container = containerRef.current
    ensureMap()
      .then(() => {
        if (!active || !container) return
        attach(container)
        setState({ status: 'ready', error: null })
      })
      .catch((error) => active && setState({ status: 'error', error: error.code ?? 'load_failed' }))
    return () => {
      active = false
      // 파괴하지 않고 떼어 놓기만 한다. 다음에 지도 탭으로 돌아오면 같은 지도를 다시 붙인다.
      if (host.node && container && host.node.parentNode === container) container.removeChild(host.node)
    }
  }, [])

  // 마커 갱신: 바뀐 것만 다시 그린다
  useEffect(() => {
    const maps = window.naver?.maps
    if (state.status !== 'ready' || !host.map || !maps) return
    const nextIds = new Set(markers.map((m) => m.id))
    for (const [id, entry] of host.markers) {
      if (!nextIds.has(id)) {
        entry.marker.setMap(null)
        host.markers.delete(id)
      }
    }
    for (const m of markers) {
      const signature = `${m.kind}|${m.lat}|${m.lng}|${m.title ?? ''}`
      const existing = host.markers.get(m.id)
      if (existing?.signature === signature) continue
      existing?.marker.setMap(null)
      const marker = new maps.Marker({
        map: host.map,
        position: new maps.LatLng(m.lat, m.lng),
        zIndex: (MARKER_KINDS[m.kind] ?? MARKER_KINDS.nearby).zIndex,
        icon: { content: markerHtml(m.kind, m.title), anchor: new maps.Point(0, 0) },
        title: m.title,
      })
      host.markers.set(m.id, { marker, signature })
    }

    // 처음 마커가 생기면 한 번만 전체가 보이게 맞춘다. (주변 장소 후보는 범위에서 제외)
    const fitTargets = markers.filter((m) => m.kind !== 'nearby')
    if (!host.fitted && !focus && fitTargets.length > 0) {
      host.fitted = true
      if (fitTargets.length === 1) {
        host.map.setCenter(new maps.LatLng(fitTargets[0].lat, fitTargets[0].lng))
        host.map.setZoom(FOCUS_ZOOM)
      } else {
        const bounds = new maps.LatLngBounds()
        fitTargets.forEach((m) => bounds.extend(new maps.LatLng(m.lat, m.lng)))
        host.map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
      }
    }
    // focus 는 "처음 전체 맞춤을 건너뛸지"만 읽는다. 값이 바뀌어도 마커를 다시 그릴 필요는 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, state.status])

  // 경로 선
  useEffect(() => {
    const maps = window.naver?.maps
    if (state.status !== 'ready' || !host.map || !maps) return
    host.line?.setMap(null)
    host.line = null
    if (path.length >= 2) {
      host.line = new maps.Polyline({
        map: host.map,
        path: path.map((p) => new maps.LatLng(p.lat, p.lng)),
        strokeColor: '#0d6efd',
        strokeOpacity: 0.7,
        strokeWeight: 4,
      })
    }
  }, [path, state.status])

  // 지정한 위치로 이동
  const focusKey = focus?.key
  useEffect(() => {
    const maps = window.naver?.maps
    if (state.status !== 'ready' || !host.map || !maps || !focus) return
    host.fitted = true // 포커스로 열린 지도는 나중에 마커가 늘어도 전체 맞춤으로 중심을 빼앗기지 않는다
    host.map.setCenter(new maps.LatLng(focus.lat, focus.lng))
    host.map.setZoom(FOCUS_ZOOM)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, state.status])

  if (state.status === 'error') {
    return (
      <div>
        <Alert variant="warning" className="small mb-2">
          {text.unavailable[state.error] ?? text.unavailable.load_failed}
        </Alert>
        {markers.length > 0 && (
          <ListGroup className="small mb-2">
            {markers.map((m) => (
              <ListGroup.Item key={m.id} className="py-1">
                <span style={{ color: (MARKER_KINDS[m.kind] ?? MARKER_KINDS.nearby).color }}>●</span> {(MARKER_KINDS[m.kind] ?? MARKER_KINDS.nearby).label}
                {m.title ? ` · ${m.title}` : ''}
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </div>
    )
  }

  return (
    <div className="map-frame mb-2" style={{ height }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {state.status === 'loading' && <div className="map-frame__loading small text-muted">{text.loading}</div>}
    </div>
  )
}
