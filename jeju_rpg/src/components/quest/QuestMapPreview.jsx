import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../constants/uiText.js'
import { loadNaverMaps } from '../../services/naver/mapLoader.js'
import { PREVIEW_HEIGHT_PX } from '../../utils/questLocation.js'
import { MARKER_KINDS, markerHtml } from '../map/markerConfig.js'

// 퀘스트 탭의 작은 지도 preview. 펼쳤을 때만 마운트된다. (접혀 있으면 지도를 만들지 않는다)
//   · NAVER SDK 는 전체 지도와 같은 로더(loadNaverMaps)를 써서 스크립트를 다시 불러오지 않는다.
//   · 전체 지도(NaverMapView)의 지도 인스턴스는 지도 탭의 DOM 에 붙어 있어서 동시에 공유할 수 없다. 그래서 이 preview 는 가벼운 별도 인스턴스를 만들고, 접거나 떠나면 정리한다.
//   · 표시: 현재 위치(있을 때) + 목적지 + 둘을 잇는 선 한 줄. 챕터 전체 경로/다른 POI 는 그리지 않는다.
export default function QuestMapPreview({ destination, position = null }) {
  const text = UI_TEXT.questMap
  const nodeRef = useRef(null)
  const [state, setState] = useState('loading') // loading | ready | error

  const lat = destination?.lat
  const lng = destination?.lng
  const hereLat = position?.lat
  const hereLng = position?.lng

  useEffect(() => {
    let active = true
    let map = null
    const overlays = []
    loadNaverMaps()
      .then((maps) => {
        if (!active || !nodeRef.current) return
        map = new maps.Map(nodeRef.current, { center: new maps.LatLng(lat, lng), zoom: 16, zoomControl: false, scaleControl: false, mapDataControl: false, logoControl: true })
        const target = new maps.LatLng(lat, lng)
        const mark = (kind, point, title) =>
          overlays.push(new maps.Marker({ map, position: point, zIndex: MARKER_KINDS[kind].zIndex, icon: { content: markerHtml(kind, title), anchor: new maps.Point(0, 0) } }))
        mark('target', target, destination.name)
        if (Number.isFinite(hereLat) && Number.isFinite(hereLng)) {
          const here = new maps.LatLng(hereLat, hereLng)
          mark('me', here, '')
          overlays.push(new maps.Polyline({ map, path: [here, target], strokeColor: '#0d6efd', strokeOpacity: 0.6, strokeWeight: 3, strokeStyle: 'shortdash' }))
          const bounds = new maps.LatLngBounds()
          bounds.extend(here)
          bounds.extend(target)
          map.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 })
        }
        setState('ready')
      })
      .catch(() => active && setState('error'))
    return () => {
      active = false
      overlays.forEach((o) => o.setMap?.(null))
      try {
        map?.destroy?.()
      } catch {
        /* 정리에 실패해도 화면에는 영향이 없다 */
      }
    }
    // destination.name 은 좌표와 함께 바뀌므로 좌표만 의존성으로 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, hereLat, hereLng])

  if (state === 'error') return <div className="small text-muted quest-map-preview__fallback">{text.unavailable}</div>
  return (
    <div className="quest-map-preview map-frame" style={{ height: PREVIEW_HEIGHT_PX }}>
      <div ref={nodeRef} style={{ width: '100%', height: '100%' }} />
      {state === 'loading' && <div className="map-frame__loading small text-muted">{UI_TEXT.map.loading}</div>}
    </div>
  )
}
