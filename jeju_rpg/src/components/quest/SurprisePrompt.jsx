import { useEffect, useRef, useState } from 'react'
import { Badge, Button } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { calcQuestExp } from '../../utils/exp.js'

const METHOD_OF = { self: 'self', gps: 'gps', gps_photo: 'gps_photo', photo_upload: 'photo_upload', photo_ai: 'photo_ai' }

// 돌발 퀘스트 출현! — 게임 이벤트 카드 overlay. (14단계 Pixel RPG 에서 이 컴포넌트와 .event-overlay CSS 만 교체하면 된다)
//   · QUEST COMPLETE 와 달리 자동으로 사라지지 않는다. [도전하기] 또는 [이번엔 지나가기]를 골라야만 닫힌다.
//     (배경 클릭/Esc 로도 닫히지 않는다. 거절은 실패가 아니고 EXP 감점/선호도 불이익이 없다. 같은 퀘스트는 다시 제안되지 않는다.)
//   · 무거운 전체 modal 이 아니라 약한 dim + 중앙 카드. 하단 네비/모바일 sticky 챕터 버튼 영역은 가리지 않아서 계속 조작할 수 있다.
//   · 카드가 화면보다 길면 카드 안에서 스크롤되어 버튼에 항상 닿을 수 있다.
// 표시 시점은 호출하는 쪽이 정한다. (QUEST COMPLETE 팝업이 끝난 뒤, REPLAN 제안이 없을 때)
export default function SurprisePrompt({ quest, onRespond }) {
  const text = UI_TEXT.schedule.surprise
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const acceptRef = useRef(null)
  const exp = calcQuestExp({ difficulty: quest.difficulty, questType: 'surprise', verificationMethod: METHOD_OF[quest.verification_type] ?? 'self' }).total

  // 나타나면 첫 버튼에 포커스를 줘서 키보드로도 바로 고를 수 있다
  useEffect(() => {
    acceptRef.current?.focus()
  }, [quest.id])

  const answer = async (action) => {
    if (sending.current) return // 연타 방지
    sending.current = true
    setBusy(true)
    try {
      await onRespond(quest, action)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="event-overlay">
      <div className="event-card" role="alertdialog" aria-labelledby="surprise-title" aria-describedby="surprise-desc">
        <div className="event-card__eyebrow">⚡ {text.eyebrow}</div>
        <h2 id="surprise-title" className="event-card__title">
          {text.title}
        </h2>
        <div className="event-card__quest">{quest.title}</div>
        <p id="surprise-desc" className="event-card__desc">
          {quest.description}
        </p>
        {quest.place_name && <div className="event-card__row">📍 {quest.place_name}</div>}
        <div className="event-card__row">
          <Badge bg="info" text="dark">
            {UI_TEXT.quest.verification[quest.verification_type]}
          </Badge>{' '}
          <Badge bg="warning" text="dark">
            {text.reward} +{exp} {UI_TEXT.progression.expPreview}
          </Badge>
        </div>
        <div className="event-card__actions">
          <Button ref={acceptRef} disabled={busy} onClick={() => answer('accept')}>
            {text.accept}
          </Button>
          <Button variant="outline-secondary" disabled={busy} onClick={() => answer('decline')}>
            {text.decline}
          </Button>
        </div>
        <div className="event-card__note">{text.noPenalty}</div>
      </div>
    </div>
  )
}
