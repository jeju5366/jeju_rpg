import { useState } from 'react'
import { Alert, Button, Card, ListGroup, ProgressBar } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { STYLE_QUESTIONS } from '../constants/styleTest.js'
import { UI_TEXT } from '../constants/uiText.js'
import StyleResultModal from '../components/style/StyleResultModal.jsx'
import { saveTravelPreferences } from '../services/supabase/profileService.js'
import { useAuthStore } from '../store/authStore.js'
import { calcStyleScores } from '../utils/styleScore.js'
import { summarizeStyle } from '../utils/styleProfile.js'

export default function StyleTestPage() {
  const text = { ...UI_TEXT.onboarding, ...UI_TEXT.style }
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted)
  const [result, setResult] = useState(null) // 저장 성공 후에만 채워진다 → 결과 Modal

  const total = STYLE_QUESTIONS.length
  const question = STYLE_QUESTIONS[step]
  const isLast = step === total - 1
  const selected = answers[step]

  const choose = (index) => {
    setAnswers((prev) => {
      const next = [...prev]
      next[step] = index
      return next
    })
  }

  const handleFinish = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const scores = calcStyleScores(answers)
      await saveTravelPreferences(user.id, scores)
      setResult(summarizeStyle(scores)) // 저장 성공 후에만 결과를 보여준다. Modal 은 이동만 한다(다시 저장하지 않는다).
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mx-auto" style={{ maxWidth: 520 }}>
      <Card.Body>
        <Card.Title as="h1" className="h4">
          {UI_TEXT.pages.styleTest.title}
        </Card.Title>
        <Card.Text className="text-muted">{text.styleIntro}</Card.Text>
        <ProgressBar now={((step + 1) / total) * 100} label={`${step + 1}/${total}`} className="mb-3" />
        {error && <Alert variant="danger">{error}</Alert>}

        <p className="fw-bold">{question.text}</p>
        <ListGroup className="mb-3">
          {question.options.map((option, index) => (
            <ListGroup.Item
              key={option.label}
              action
              type="button"
              active={selected === index}
              onClick={() => choose(index)}
            >
              {option.label}
            </ListGroup.Item>
          ))}
        </ListGroup>

        {result && (
          <StyleResultModal
            summary={result}
            continueLabel={onboardingCompleted ? text.backToProfile : text.continueSetup}
            // 온보딩을 이미 끝낸 사용자의 재테스트는 모험가 탭으로, 신규 사용자는 여행 설정으로 이어진다.
            onContinue={() => navigate(onboardingCompleted ? '/profile' : '/setup', { replace: true })}
          />
        )}

        <div className="d-flex gap-2">
          <Button
            variant="outline-secondary"
            disabled={step === 0 || submitting || Boolean(result)}
            onClick={() => setStep(step - 1)}
          >
            {text.prev}
          </Button>
          {isLast ? (
            <Button className="flex-grow-1" disabled={selected == null || submitting || Boolean(result)} onClick={handleFinish}>
              {submitting ? text.saving : text.styleFinish}
            </Button>
          ) : (
            <Button className="flex-grow-1" disabled={selected == null} onClick={() => setStep(step + 1)}>
              {text.next}
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  )
}