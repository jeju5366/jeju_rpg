import { UI_TEXT } from '../../constants/uiText.js'
import { progressHint, questExpPreview, questGrowthPreview, VERIFICATION_ICON } from '../../utils/questLayout.js'
import { CategoryChips } from '../common/CategoryChip.jsx'

// 미완료 선택 퀘스트의 접힌(compact) 모양: 제목(핵심 행동) / 인증 방식 · 받을 EXP / 펼치기 표시.
// 카드 전체가 하나의 button 이라 탭 영역이 넓고, aria-expanded 와 키보드(Enter/Space)를 그대로 쓴다.
// 펼치면 기존 QuestCard(설명 + 인증 버튼)가 나타난다. (이 컴포넌트 안에는 다른 버튼이 없어서 클릭이 충돌하지 않는다)
export default function CompactQuestRow({ quest, progress, onOpen }) {
  const text = UI_TEXT.quest
  const photoText = UI_TEXT.photo
  const { planned } = questExpPreview(quest)
  const hint = progressHint(quest, progress)
  const growth = questGrowthPreview(quest)

  return (
    <button type="button" className="quest-row" aria-expanded="false" onClick={onOpen}>
      <span className="quest-row__main">
        <span className="quest-row__title">
          <span aria-hidden="true">{VERIFICATION_ICON[quest.verification_type] ?? '📝'}</span> {quest.title}
        </span>
        <span className="quest-row__meta">
          {text.verification[quest.verification_type]} · +{planned} {UI_TEXT.progression.expPreview}
          {hint === 'gps_done' && <span className="quest-row__hint"> · {photoText.gpsStep} {photoText.stepDone}</span>}
          {hint === 'photo_done' && <span className="quest-row__hint"> · {photoText.photoStep} {photoText.stepDone}</span>}
        </span>
        {/* 펼치지 않아도 어떤 카테고리가 성장하는지 보이게 한다 */}
        <span className="quest-row__growth">
          <span className="quest-row__growth-label">{UI_TEXT.questLayout.growthPreview}</span>
          <CategoryChips parts={growth} />
        </span>
      </span>
      <span className="quest-row__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
