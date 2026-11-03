import { Button, Form } from 'react-bootstrap'
import { COMPANIONS, TRANSPORTS } from '../../constants/onboarding.js'
import { UI_TEXT } from '../../constants/uiText.js'

// 일일 조건 입력칸 (동행 / 인원 / 이동수단 / 종료 희망 시간). 홈의 "오늘 조건 수정"과 모험 생성 전 확인에서 같이 쓴다.
// values: { companion, party_size, transport, desired_end_time }
export default function DailyContextFields({ values, onChange, disabled }) {
  const text = UI_TEXT.daily
  const set = (patch) => onChange({ ...values, ...patch })

  return (
    <>
      <div className="d-flex gap-2 mb-3">
        <Form.Group className="flex-grow-1" controlId="daily-companion">
          <Form.Label>{text.companion}</Form.Label>
          <Form.Select
            value={values.companion}
            disabled={disabled}
            onChange={(e) => set({ companion: e.target.value, ...(e.target.value === 'solo' ? { party_size: 1 } : {}) })}
          >
            {COMPANIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group controlId="daily-party-size" style={{ width: 100 }}>
          <Form.Label>{text.partySize}</Form.Label>
          <Form.Control
            type="number"
            min={1}
            max={50}
            disabled={disabled || values.companion === 'solo'}
            value={values.party_size}
            onChange={(e) => set({ party_size: e.target.value })}
          />
        </Form.Group>
      </div>

      <Form.Group className="mb-3" controlId="daily-transport">
        <Form.Label>{text.transport}</Form.Label>
        <Form.Select value={values.transport} disabled={disabled} onChange={(e) => set({ transport: e.target.value })}>
          {TRANSPORTS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Form.Select>
      </Form.Group>

      <Form.Group className="mb-2" controlId="daily-end-time">
        <Form.Label>{text.desiredEnd}</Form.Label>
        <div className="d-flex gap-2">
          <Form.Control type="time" disabled={disabled} value={values.desired_end_time ?? ''} onChange={(e) => set({ desired_end_time: e.target.value || null })} />
          <Button variant="outline-secondary" disabled={disabled || !values.desired_end_time} onClick={() => set({ desired_end_time: null })}>
            {text.clearEndTime}
          </Button>
        </div>
      </Form.Group>
    </>
  )
}