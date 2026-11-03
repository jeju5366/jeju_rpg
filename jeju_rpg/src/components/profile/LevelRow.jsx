import { ProgressBar } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'

// 카테고리 1개의 레벨/EXP 진행. levelInfo 는 src/utils/level.js 의 levelFromExp 결과.
export default function LevelRow({ label, levelInfo, exp }) {
  const text = UI_TEXT.progression.profile
  const percent = levelInfo.isMax ? 100 : Math.round((levelInfo.expIntoLevel / levelInfo.expForNextLevel) * 100)
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between">
        <strong>{label}</strong>
        <span>
          {text.level}
          {levelInfo.level}
          {levelInfo.isMax ? ` (${text.max})` : ''}
        </span>
      </div>
      <ProgressBar now={percent} className="my-1" />
      <div className="small text-muted">
        EXP {exp}
        {!levelInfo.isMax && ` · 다음 레벨까지 ${levelInfo.expForNextLevel - levelInfo.expIntoLevel}`}
      </div>
    </div>
  )
}