import { Alert } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'

const levelLabel = (category) => (category === 'overall' ? UI_TEXT.progression.reward.overall : UI_TEXT.categories[category] ?? category)

// 방금 받은 보상 요약. 퀘스트 EXP / 발견 / 챕터·모험 자유 EXP / 레벨업을 한 곳에서 보여준다. (연출은 과하지 않게 텍스트만)
// rewards: { questExp, discovery, chapterBonus, adventureBonus, levelUps }
export default function RewardNotice({ rewards, onClose }) {
  const text = UI_TEXT.progression.reward
  if (!rewards) return null
  const { questExp, discovery, chapterBonus = 0, adventureBonus = 0, levelUps = [] } = rewards
  const hasAnything = questExp || discovery || chapterBonus || adventureBonus || levelUps.length
  if (!hasAnything) return null

  return (
    <Alert variant="success" dismissible onClose={onClose} className="small">
      {questExp &&
        (questExp.awarded ? (
          <div>
            {text.questExp} +{questExp.total} {text.exp} (
            {questExp.parts.map((part) => `${UI_TEXT.categories[part.category] ?? part.category} ${part.amount}`).join(' / ')})
          </div>
        ) : (
          <div>{text.alreadyAwarded}</div>
        ))}
      {discovery && (
        <div className="fw-bold">
          ✨ {discovery.type === 'landmark' ? text.landmarkDiscovery : text.discovery} {discovery.placeName} · {UI_TEXT.categories.discovery} +{discovery.amount} {text.exp}
        </div>
      )}
      {chapterBonus > 0 && (
        <div>
          {text.chapterBonus} +{chapterBonus}
        </div>
      )}
      {adventureBonus > 0 && (
        <div>
          {text.adventureBonus} +{adventureBonus}
        </div>
      )}
      {(chapterBonus > 0 || adventureBonus > 0) && <div className="text-muted">{text.freeExpHint}</div>}
      {levelUps.map((up) => (
        <div key={up.category} className="fw-bold">
          🎉 {levelLabel(up.category)} {text.levelUp} Lv.{up.from} → Lv.{up.to}
        </div>
      ))}
    </Alert>
  )
}