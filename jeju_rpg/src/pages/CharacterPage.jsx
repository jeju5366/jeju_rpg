import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, ListGroup } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { BODY_TYPES, NICKNAME_MAX } from '../constants/onboarding.js'
import { UI_TEXT } from '../constants/uiText.js'
import {
  fetchCharacter,
  saveCharacter,
  updateNickname,
} from '../services/supabase/profileService.js'
import { useAuthStore } from '../store/authStore.js'

export default function CharacterPage() {
  const text = UI_TEXT.onboarding
  const navigate = useNavigate()
  const { user, profile, setProfile } = useAuthStore()
  const [nickname, setNickname] = useState(profile?.nickname ?? '')
  const [bodyType, setBodyType] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // 이미 만든 캐릭터가 있으면 신체 유형을 채워준다.
  useEffect(() => {
    let active = true
    fetchCharacter(user.id)
      .then((character) => {
        if (active && character) setBodyType(character.body_type)
      })
      .catch((err) => console.error('[character] 불러오기 실패', err))
    return () => {
      active = false
    }
  }, [user.id])

  const trimmed = nickname.trim()
  const canSubmit = trimmed.length >= 1 && trimmed.length <= NICKNAME_MAX && bodyType && !submitting

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      setProfile(await updateNickname(user.id, trimmed)) // 닉네임 → jeju_profiles
      await saveCharacter(user.id, bodyType) // 신체 유형 → jeju_characters
      navigate('/style-test')
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
          {UI_TEXT.pages.character.title}
        </Card.Title>
        <Card.Text>{text.characterIntro}</Card.Text>
        {error && <Alert variant="danger">{error}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3" controlId="character-nickname">
            <Form.Label>{text.nickname}</Form.Label>
            <Form.Control
              value={nickname}
              maxLength={NICKNAME_MAX}
              placeholder={text.nicknameHint}
              onChange={(e) => setNickname(e.target.value)}
            />
          </Form.Group>

          <Form.Label>{text.bodyType}</Form.Label>
          <ListGroup className="mb-3">
            {BODY_TYPES.map((type) => (
              <ListGroup.Item
                key={type.id}
                action
                type="button"
                active={bodyType === type.id}
                onClick={() => setBodyType(type.id)}
              >
                <strong>{type.label}</strong>
                {type.desc && <div className="small">{type.desc}</div>}
              </ListGroup.Item>
            ))}
          </ListGroup>

          <Button type="submit" className="w-100" disabled={!canSubmit}>
            {submitting ? text.saving : text.next}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  )
}