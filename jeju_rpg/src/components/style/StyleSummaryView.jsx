import { ProgressBar } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'

// 성향 요약(RPG 성향 타이틀 + 상위 3개 성향 점수 + 설명 + 식사/디저트 관심도). 성향 결과 Modal 과 모험가 탭 카드가 같이 쓴다.
// summary: summarizeStyle() 결과
export default function StyleSummaryView({ summary, showDescription = true, showAll = false }) {
  const text = UI_TEXT.style
  const rows = showAll ? summary.all : summary.top
  return (
    <div className="style-summary">
      <div className="style-summary__title">{summary.title}</div>
      <div className="mb-2">
        {rows.map((row) => (
          <div key={row.axis} className="style-summary__row">
            <span className="style-summary__label">{row.label}</span>
            <ProgressBar now={row.score} className="flex-grow-1" style={{ height: 8 }} aria-label={`${row.label} ${row.score}`} />
            <span className="style-summary__score">{row.score}</span>
          </div>
        ))}
      </div>
      {showDescription && summary.description.map((line) => <p key={line} className="small mb-1">{line}</p>)}
      {(summary.meal !== null || summary.dessert !== null) && (
        <div className="small text-muted">
          {summary.meal !== null && <span className="me-3">{text.meal} {summary.meal}</span>}
          {summary.dessert !== null && <span>{text.dessert} {summary.dessert}</span>}
        </div>
      )}
    </div>
  )
}
