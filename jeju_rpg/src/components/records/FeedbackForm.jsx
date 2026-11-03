import { useState } from 'react'
import { Alert, Button, ButtonGroup, Form } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { saveTripFeedback } from '../../services/finalQuest/finalQuestService.js'

function Choice({ label, value, onChange, options }) {
  return (
    <div className="mb-2">
      <div className="small fw-semibold mb-1">{label}</div>
      <ButtonGroup className="w-100">
        {options.map(([key, text]) => (
          <Button key={key} size="sm" variant={value === key ? 'primary' : 'outline-secondary'} onClick={() => onChange(value === key ? null : key)}>
            {text}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  )
}

// 여행 피드백 입력. 저장하면 다음 여행의 Agent context 에 반영된다. (여행당 1건, 다시 저장하면 덮어씀)
export default function FeedbackForm({ tripId, initial = null }) {
  const t = UI_TEXT.finalQuest
  const [rating, setRating] = useState(initial?.rating ?? null)
  const [density, setDensity] = useState(initial?.density ?? null)
  const [placesRating, setPlacesRating] = useState(initial?.placesRating ?? null)
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? null)
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await saveTripFeedback(tripId, { rating, density, placesRating, difficulty, comment: comment.trim() || null })
      setMessage(t.summary.feedbackSaved)
    } catch (err) {
      setError(t.feedback.errors[err.code] ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="small fw-semibold mb-1">{t.feedback.rating}</div>
      <div className="d-flex gap-1 mb-2" role="radiogroup" aria-label={t.feedback.rating}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Button key={n} size="sm" variant={rating === n ? 'warning' : 'outline-secondary'} aria-checked={rating === n} role="radio" onClick={() => setRating(rating === n ? null : n)}>
            ★{n}
          </Button>
        ))}
      </div>
      <Choice label={t.feedback.density} value={density} onChange={setDensity} options={Object.entries(t.feedback.densities)} />
      <Choice label={t.feedback.places} value={placesRating} onChange={setPlacesRating} options={Object.entries(t.feedback.placesOptions)} />
      <Choice label={t.feedback.difficulty} value={difficulty} onChange={setDifficulty} options={Object.entries(t.feedback.difficulties)} />
      <Form.Group className="mb-2">
        <Form.Label className="small fw-semibold mb-1">{t.feedback.comment}</Form.Label>
        <Form.Control as="textarea" rows={2} maxLength={200} value={comment} placeholder={t.feedback.commentPlaceholder} onChange={(e) => setComment(e.target.value)} />
      </Form.Group>
      {error && (
        <Alert variant="danger" className="small py-2">
          {error}
        </Alert>
      )}
      {message && (
        <Alert variant="success" className="small py-2">
          {message}
        </Alert>
      )}
      <Button className="w-100" disabled={saving} onClick={save}>
        {saving ? t.summary.saving : t.summary.save}
      </Button>
    </div>
  )
}
