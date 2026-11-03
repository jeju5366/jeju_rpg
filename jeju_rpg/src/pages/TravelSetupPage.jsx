import { useState } from 'react'
import { Alert, Button, Card, Form } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { TRAVEL_RANGES } from '../constants/gameBalance.js'
import { COMPANIONS, TRANSPORTS } from '../constants/onboarding.js'
import { UI_TEXT } from '../constants/uiText.js'
import { ensureProfile } from '../services/supabase/profileService.js'
import { fetchLatestTrip, saveTripSetup } from '../services/supabase/tripService.js'
import { useAuthStore } from '../store/authStore.js'
import { useTripStore } from '../store/tripStore.js'

// address 는 선택. 위도/경도는 지도 연동(9단계)에서 채우므로 지금은 입력받지 않는다.
const emptyAccommodation = () => ({ name: '', address: '', checkIn: '', checkOut: '' })

// 저장이 성공하면(DB 함수가 onboarding_completed 도 함께 올림) 프로필을 다시 읽어 홈으로 보낸다.
export default function TravelSetupPage() {
  const text = UI_TEXT.onboarding
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setProfile = useAuthStore((s) => s.setProfile)
  const { setupDraft, setSetupDraft, setTrip, setAccommodations } = useTripStore()
  const [form, setForm] = useState(
    setupDraft ?? {
      startDate: '',
      endDate: '',
      companion: '',
      partySize: '1',
      transport: '',
      travelRange: '',
      desiredEndTime: '',
      departureDateTime: '',
      accommodations: [emptyAccommodation()],
      arrivalFlight: '',
      departureFlight: '',
    },
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const update = (patch) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  const updateAccommodation = (index, patch) => {
    update({
      accommodations: form.accommodations.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    })
  }

  const datesValid = form.startDate && form.endDate && form.startDate <= form.endDate
  // 숙소 날짜는 여행 기간 안이어야 한다.
  const accommodationsValid = form.accommodations.every(
    (a) =>
      a.name.trim() &&
      a.checkIn &&
      a.checkOut &&
      a.checkIn <= a.checkOut &&
      a.checkIn >= form.startDate &&
      a.checkOut <= form.endDate,
  )
  const partySizeValid = Number.isInteger(Number(form.partySize)) && Number(form.partySize) >= 1 && Number(form.partySize) <= 50
  const canSubmit =
    datesValid && form.companion && partySizeValid && form.transport && accommodationsValid && !submitting

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setSetupDraft(form)
    try {
      await saveTripSetup(form)
      const trip = await fetchLatestTrip(user.id)
      setTrip(trip)
      setAccommodations(trip?.accommodations ?? [])
      setSetupDraft(null)
      setProfile(await ensureProfile(user.id)) // onboarding_completed 반영 → 가드 통과
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Card className="mx-auto" style={{ maxWidth: 560 }}>
      <Card.Body>
        <Card.Title as="h1" className="h4">
          {UI_TEXT.pages.setup.title}
        </Card.Title>
        <Card.Text className="text-muted">{text.setupIntro}</Card.Text>

        <Form onSubmit={handleSubmit}>
          <Form.Label>{text.setupDates}</Form.Label>
          <div className="d-flex gap-2 mb-3">
            <Form.Control
              type="date"
              aria-label={text.startDate}
              value={form.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
            />
            <Form.Control
              type="date"
              aria-label={text.endDate}
              min={form.startDate || undefined}
              value={form.endDate}
              onChange={(e) => update({ endDate: e.target.value })}
            />
          </div>

          <div className="d-flex gap-2 mb-3">
            <Form.Group className="flex-grow-1" controlId="setup-companion">
              <Form.Label>{text.companion}</Form.Label>
              <Form.Select
                value={form.companion}
                onChange={(e) => update({ companion: e.target.value, ...(e.target.value === 'solo' ? { partySize: '1' } : {}) })}
              >
                <option value="">선택해줘</option>
                {COMPANIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="setup-party-size" style={{ width: 110 }}>
              <Form.Label>{text.partySize}</Form.Label>
              <Form.Control
                type="number"
                min={1}
                max={50}
                disabled={form.companion === 'solo'}
                value={form.partySize}
                onChange={(e) => update({ partySize: e.target.value })}
              />
            </Form.Group>
          </div>

          <Form.Group className="mb-3" controlId="setup-transport">
            <Form.Label>{text.transport}</Form.Label>
            <Form.Select value={form.transport} onChange={(e) => update({ transport: e.target.value })}>
              <option value="">선택해줘</option>
              {TRANSPORTS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3" controlId="setup-travel-range">
            <Form.Label>{text.travelRange}</Form.Label>
            <Form.Select value={form.travelRange} onChange={(e) => update({ travelRange: e.target.value })}>
              <option value="">정하지 않을래</option>
              {TRAVEL_RANGES.map((key) => (
                <option key={key} value={key}>
                  {UI_TEXT.adventure.ranges[key].label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Label className="mb-0">{text.accommodation}</Form.Label>
          <Form.Text className="d-block text-muted mb-2">{text.accommodationHelp}</Form.Text>
          {form.accommodations.map((acc, index) => (
            <Card key={index} body className="mb-2">
              <Form.Control
                className="mb-2"
                placeholder={text.accommodationName}
                value={acc.name}
                onChange={(e) => updateAccommodation(index, { name: e.target.value })}
              />
              <Form.Control
                className="mb-2"
                placeholder={text.accommodationAddress}
                value={acc.address}
                onChange={(e) => updateAccommodation(index, { address: e.target.value })}
              />
              <div className="d-flex gap-2">
                <Form.Control
                  type="date"
                  aria-label={text.checkIn}
                  value={acc.checkIn}
                  onChange={(e) => updateAccommodation(index, { checkIn: e.target.value })}
                />
                <Form.Control
                  type="date"
                  aria-label={text.checkOut}
                  min={acc.checkIn || undefined}
                  value={acc.checkOut}
                  onChange={(e) => updateAccommodation(index, { checkOut: e.target.value })}
                />
                {form.accommodations.length > 1 && (
                  <Button
                    variant="outline-danger"
                    onClick={() =>
                      update({ accommodations: form.accommodations.filter((_, i) => i !== index) })
                    }
                  >
                    {text.removeAccommodation}
                  </Button>
                )}
              </div>
            </Card>
          ))}
          <Button
            variant="outline-secondary"
            size="sm"
            className="mb-3"
            onClick={() => update({ accommodations: [...form.accommodations, emptyAccommodation()] })}
          >
            {text.addAccommodation}
          </Button>

          <Form.Label className="d-block mb-0">{text.flights}</Form.Label>
          <Form.Text className="d-block text-muted mb-2">{text.flightHelp}</Form.Text>
          <div className="d-flex gap-2 mb-3">
            <Form.Group className="flex-grow-1" controlId="setup-arrival-flight">
              <Form.Label className="small text-muted mb-1">{text.arrivalFlight}</Form.Label>
              <Form.Control placeholder={text.flightExample} value={form.arrivalFlight} onChange={(e) => update({ arrivalFlight: e.target.value })} />
            </Form.Group>
            <Form.Group className="flex-grow-1" controlId="setup-departure-flight">
              <Form.Label className="small text-muted mb-1">{text.departureFlight}</Form.Label>
              <Form.Control placeholder={text.flightExample} value={form.departureFlight} onChange={(e) => update({ departureFlight: e.target.value })} />
            </Form.Group>
          </div>

          <div className="d-flex gap-2 mb-3">
            <Form.Group className="flex-grow-1" controlId="setup-end-time">
              <Form.Label>{text.desiredEndTime}</Form.Label>
              <Form.Control
                type="time"
                value={form.desiredEndTime}
                onChange={(e) => update({ desiredEndTime: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="flex-grow-1" controlId="setup-departure-datetime">
              <Form.Label>{text.departureDateTime}</Form.Label>
              <Form.Control
                type="datetime-local"
                value={form.departureDateTime}
                onChange={(e) => update({ departureDateTime: e.target.value })}
              />
              <Form.Text className="text-muted">{text.departureDateTimeHelp}</Form.Text>
            </Form.Group>
          </div>

          {error && <Alert variant="danger">{error}</Alert>}
          <Button type="submit" className="w-100" disabled={!canSubmit}>
            {submitting ? text.saving : text.setupSave}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  )
}