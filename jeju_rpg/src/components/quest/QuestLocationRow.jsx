import { useEffect, useState } from 'react'
import { Button } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { queryPermission, getCurrentPosition } from '../../services/location/geolocation.js'
import { useLocationStore } from '../../store/locationStore.js'
import { resolveEvalPosition } from '../../utils/finalQuestPosition.js'
import { describeDistance, distanceSummary, initialPreviewOpen, mapFocusTarget, togglePreview } from '../../utils/questLocation.js'
import useViewOnMap from '../map/useViewOnMap.js'
import QuestMapPreview from './QuestMapPreview.jsx'

// 현재 챕터 목적지의 compact 위치 요약 한 줄 + 접이식 지도 preview.
//   "📍 성산일출봉 전망대" / "약 420m · 도보 약 6분"  [지도 보기] [지도에서 보기]
//   · 기본은 접힘(지도를 만들지 않는다). [지도 보기]를 누르면 180~220px 의 작은 지도가 펼쳐지고, 다시 누르면 접힌다. 새로고침하면 다시 접힌 상태.
//   · 거리/시간은 최근의 유효한 현재 위치가 있을 때만 보여준다. 위치가 없거나 오래되면 그 줄은 그리지 않는다. 새 GPS polling 은 없다.
//     (위치 권한이 이미 허용돼 있을 때만 이 화면이 열릴 때 한 번 조용히 받아 본다.)
export default function QuestLocationRow({ destination, transport }) {
  const text = UI_TEXT.questMap
  const viewOnMap = useViewOnMap()
  const stored = useLocationStore((s) => s.position)
  const [open, setOpen] = useState(initialPreviewOpen)
  const [now] = useState(() => Date.now())

  // 오래된 위치면 권한이 이미 허용된 경우에만 한 번 새로 받는다 (resolveEvalPosition 재사용). 렌더마다/주기적으로 요청하지 않는다.
  useEffect(() => {
    let active = true
    resolveEvalPosition({
      stored,
      getPermission: queryPermission,
      getPosition: () => getCurrentPosition({ timeoutMs: 6000, maxAgeMs: 30000 }),
      onFresh: (fresh) => active && useLocationStore.getState().setPosition(fresh),
    })
    return () => {
      active = false
    }
    // 화면이 열릴 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!destination) return null
  const summary = distanceSummary({ position: stored, destination, transport, now: Math.max(now, Date.now()) })

  return (
    <div className="quest-location" role="group" aria-label={text.label}>
      <div className="quest-location__row">
        <div className="quest-location__text">
          <div className="quest-location__name">📍 {destination.name}</div>
          {summary && (
            <div className="quest-location__meta small text-muted">
              {text.fromHere} {describeDistance(summary)}
            </div>
          )}
        </div>
        <div className="quest-location__actions">
          <Button size="sm" variant="outline-secondary" aria-expanded={open} onClick={() => setOpen(togglePreview)}>
            {open ? text.collapse : text.expand}
          </Button>
          <Button size="sm" variant="outline-primary" onClick={() => viewOnMap(mapFocusTarget({ destination }))}>
            {text.viewOnMap}
          </Button>
        </div>
      </div>
      {open && <QuestMapPreview destination={destination} position={summary ? stored : null} />}
    </div>
  )
}
