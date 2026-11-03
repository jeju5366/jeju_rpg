import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../constants/uiText.js'
import { getTravelPreview, peekTravelPreview } from '../../services/travel/travelPreview.js'
import { describeTravel } from '../../utils/travel.js'

// 다음 챕터 예고(compact): "다음 챕터 · ○○ 일대 · 차량 약 12분" 한 줄 + 작은 보조 문구.
//   · 다음 챕터의 핵심/선택 퀘스트 내용은 보여주지 않는다. (장소 + 이동 정보만)
//   · 이동 정보: 자동차는 NAVER Directions(캐시), 대중교통/도보는 보수적 추정(예상 표시). 화면이 뜰 때마다 API 를 부르지 않는다.
// from: 현재 챕터 핵심 장소 좌표 | null, to: 다음 챕터 핵심 장소 { name, lat, lng }
export default function NextChapterPreview({ from, to, transport, onEstimate }) {
  const text = UI_TEXT.schedule.preview
  const [estimate, setEstimate] = useState(() => (from && to ? peekTravelPreview({ from, to, transport }) : null))
  const key = from && to ? `${from.lat},${from.lng}>${to.lat},${to.lng}:${transport}` : null

  useEffect(() => {
    if (!from || !to) return undefined
    let active = true
    getTravelPreview({ from, to, transport }).then((value) => {
      if (!active) return
      setEstimate(value)
      onEstimate?.(value)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!to?.name) return null
  return (
    <div className="next-preview" role="note">
      <div className="next-preview__line">
        <span aria-hidden="true">🧭</span> <strong>{text.chapterLabel}</strong> · {text.area(to.name)}
        {from && <> · {estimate ? describeTravel(estimate) : text.loading}</>}
      </div>
      <div className="next-preview__note">{text.note}</div>
    </div>
  )
}
