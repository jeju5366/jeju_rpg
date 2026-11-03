import { Badge } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { useAgentLogStore } from '../../store/agentLogStore.js'

const LEVEL_VARIANT = { info: 'secondary', warning: 'warning', success: 'success' }
const TYPE_LABEL = { context: '컨텍스트', filter: '필터', decision: '결정', replan: 'REPLAN', surprise: 'Surprise', fallback: 'Fallback', system: '시스템', demo: 'DEMO' }
const time = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

// AGENT LOG: 입력 상태 / 규칙 판단 결과 / fallback 여부 / 이벤트 발생·억제 이유의 "결정 요약". (내부 추론이나 원문이 아니다)
// 14단계 Pixel RPG 디자인에서 이 컴포넌트와 .agent-log CSS 만 교체하면 된다.
export default function AgentLogPanel({ hideTitle = false }) {
  const entries = useAgentLogStore((s) => s.entries)
  const text = UI_TEXT.agentLog
  return (
    <section className="agent-log" aria-label={text.title}>
      {!hideTitle && <h2 className="agent-log__title">{text.title}</h2>}
      {entries.length === 0 && <div className="small text-muted">{text.empty}</div>}
      <ol className="agent-log__list">
        {entries.map((entry) => (
          <li key={entry.id} className={`agent-log__item agent-log__item--${entry.level}`}>
            <div className="agent-log__head">
              <Badge bg={LEVEL_VARIANT[entry.level] ?? 'secondary'} text={entry.level === 'warning' ? 'dark' : undefined}>
                {TYPE_LABEL[entry.type] ?? entry.type}
              </Badge>
              <span className="agent-log__time">{time(entry.timestamp)}</span>
            </div>
            <div className="agent-log__name">{entry.title}</div>
            {entry.message && <div className="agent-log__message">{entry.message}</div>}
          </li>
        ))}
      </ol>
    </section>
  )
}
