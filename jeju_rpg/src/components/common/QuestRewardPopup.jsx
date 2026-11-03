import { useEffect } from 'react'
import { UI_TEXT } from '../../constants/uiText.js'
import { CategoryChip, CategoryChips } from './CategoryChip.jsx'

const categoryLabel = (category) => (category === 'overall' ? UI_TEXT.popup.overall : (UI_TEXT.categories[category] ?? category))
// 레벨업 줄: 전체 레벨을 먼저, 그다음 카테고리 순서(서버가 준 순서 유지). 표시 순서만 바꾸고 값은 그대로다.
const overallFirst = (levelUps) => [...levelUps.filter((up) => up.category === 'overall'), ...levelUps.filter((up) => up.category !== 'overall')]

// 퀘스트 완료 결과 팝업 (게임식 결과 알림). 14단계 Pixel RPG 에서 이 컴포넌트와 .reward-popup CSS 만 교체하면 된다.
//   구조(모바일에서 짧게): QUEST COMPLETE! / 퀘스트 제목 / +N EXP (가장 크게) / 획득한 성장 [카테고리 chip] / 특별 보상 [발견 chip] / [LEVEL UP! 줄들] / 탭하면 닫혀요
//   · 서버가 확정한 지급 결과(buildRewardPopup 이 만든 데이터)만 그린다. EXP/레벨을 직접 계산하지 않는다.
//   · 강제 확인 버튼 없이: 정해진 시간(일반 4초 / 레벨업 5초) 뒤 자동으로 닫히고, 탭/클릭하면 바로 닫힌다. 화면을 막는 modal 이 아니라 위쪽에 뜨는 알림 카드다.
//   · 연속 완료는 queue 로 순서대로 하나씩 보여준다.
// queue: 보여줄 팝업 목록(맨 앞이 현재) / onClose(id): 현재 팝업 닫기
export default function QuestRewardPopup({ queue, onClose }) {
  const current = queue[0] ?? null
  const text = UI_TEXT.popup

  // 현재 팝업의 자동 종료 타이머. 팝업이 바뀌거나 사용자가 먼저 닫으면 정리된다.
  const id = current?.id
  const durationMs = current?.durationMs
  useEffect(() => {
    if (!id) return undefined
    const timer = setTimeout(() => onClose(id), durationMs)
    return () => clearTimeout(timer)
  }, [id, durationMs, onClose])

  if (!current) return null
  const waiting = queue.length - 1
  const main = current.items.find((item) => item.kind === 'quest') ?? current.items[0] // 가장 크게 강조: 퀘스트 보상 EXP
  const extras = current.items.filter((item) => item !== main) // 발견 EXP 는 별도 항목
  const extraLabel = (item) => (item.kind === 'landmark' ? text.landmarkShort : text.discoveryShort)
  // 획득한 성장: 실제 지급된 카테고리별 EXP (서버 응답의 parts 그대로). 일반 카테고리 성장과 발견 EXP 는 섞지 않는다.
  const growth = main.kind === 'quest' ? (main.parts ?? []) : []

  return (
    <div className="reward-popup-layer" role="status" aria-live="polite">
      <button type="button" className="reward-popup" onClick={() => onClose(current.id)} aria-label={`${text.title} ${current.questTitle}. ${text.dismissHint}`}>
        <span className="reward-popup__title">{text.title}</span>
        {current.questTitle && <span className="reward-popup__quest">{current.questTitle}</span>}

        <span className="reward-popup__big">
          +{main.amount} <span className="reward-popup__unit">EXP</span>
        </span>
        {growth.length > 0 && (
          <span className="reward-popup__section">
            <span className="reward-popup__section-label">{text.growth}</span>
            <CategoryChips parts={growth} />
          </span>
        )}

        {/* 특별 보상: 발견 EXP 가 실제로 지급된 경우에만, 일반 카테고리 성장과 분리해서 표시 */}
        {extras.length > 0 && (
          <span className="reward-popup__section">
            <span className="reward-popup__section-label">{text.special}</span>
            <span className="cat-chips">
              {extras.map((item) => (
                <CategoryChip key={item.kind} category="discovery" label={extraLabel(item)} amount={item.amount} />
              ))}
            </span>
            {extras.map((item) => item.placeName && <span key={`p-${item.kind}`} className="reward-popup__sub">📍 {item.placeName}</span>)}
          </span>
        )}
        {current.showTotal && <span className="reward-popup__sub">{text.totalSmall(current.totalExp)}</span>}

        {current.levelUps.length > 0 && (
          <span className="reward-popup__levelup">
            <strong>{text.levelUp}</strong>
            {overallFirst(current.levelUps).map((up) => (
              <span key={up.category}>
                {categoryLabel(up.category)} Lv.{up.from} → Lv.{up.to}
              </span>
            ))}
          </span>
        )}

        <span className="reward-popup__hint">{waiting > 0 ? text.moreWaiting(waiting) : text.dismissHint}</span>
      </button>
    </div>
  )
}
