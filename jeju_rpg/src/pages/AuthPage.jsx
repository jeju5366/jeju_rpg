import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form } from 'react-bootstrap'
import { UI_TEXT } from '../constants/uiText.js'
import { isSupabaseConfigured } from '../lib/env.js'
import DemoScenarioModal from '../components/demo/DemoScenarioModal.jsx'
import { startDemoScenario } from '../demo/demoController.js'
import { signInWithEmail, signUpWithEmail } from '../services/supabase/authService.js'

export default function AuthPage() {
  const text = UI_TEXT.auth
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [demoOpen, setDemoOpen] = useState(false)
  const navigate = useNavigate()

  const isSignUp = mode === 'signup'

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      if (isSignUp) {
        const { session } = await signUpWithEmail(email.trim(), password)
        // 세션이 오면 store 가 갱신되어 라우터가 알아서 이동시킨다.
        if (!session) setNotice(text.checkEmail)
      } else {
        await signInWithEmail(email.trim(), password)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const toggleMode = () => {
    setMode(isSignUp ? 'signin' : 'signup')
    setError(null)
    setNotice(null)
  }

  return (
    <Card className="mx-auto" style={{ maxWidth: 420 }}>
      <Card.Body>
        <Card.Title as="h1" className="h4 mb-3">
          {isSignUp ? text.signUpTitle : text.signInTitle}
        </Card.Title>

        {!isSupabaseConfigured && <Alert variant="warning">{text.notConfigured}</Alert>}
        {error && <Alert variant="danger">{error}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3" controlId="auth-email">
            <Form.Label>{text.email}</Form.Label>
            <Form.Control
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="auth-password">
            <Form.Label>{text.password}</Form.Label>
            <Form.Control
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Form.Group>
          <Button type="submit" className="w-100" disabled={submitting || !isSupabaseConfigured}>
            {submitting ? text.submitting : isSignUp ? text.signUp : text.signIn}
          </Button>
        </Form>

        <Button variant="link" className="w-100 mt-2" onClick={toggleMode}>
          {isSignUp ? text.toSignIn : text.toSignUp}
        </Button>
        <hr />
        {/* 발표/기능 확인용 Demo Mode 진입점. 실제 관리자 권한이 아니다. */}
        <Button variant="outline-secondary" size="sm" className="w-100" onClick={() => setDemoOpen(true)}>
          {UI_TEXT.demo.entry}
        </Button>
        <DemoScenarioModal
          show={demoOpen}
          onHide={() => setDemoOpen(false)}
          onSelect={(id) => {
            if (startDemoScenario(id)) navigate('/', { replace: true })
            setDemoOpen(false)
          }}
        />
      </Card.Body>
    </Card>
  )
}