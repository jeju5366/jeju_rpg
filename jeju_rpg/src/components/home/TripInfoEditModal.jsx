import { useState } from 'react'
import { Alert, Button, Card, Form, Modal } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { toKstInputValue } from '../../utils/time.js'

// 홈의 "여행 정보 수정" (기간 / 숙소 / 출발 항공편). 저장만 하고 Agent 는 호출하지 않는다.
// 이후 Agent 는 호출될 때마다 DB 의 최신 값을 다시 읽는다.
export default function TripInfoEditModal({ trip, busy, error, onSave, onClose }) {
  const text = UI_TEXT.onboarding
  const home = UI_TEXT.home
  const [form, setForm] = useState({
    startDate: trip.start_date,
    endDate: trip.end_date,
    departureFlight: trip.departure_flight ?? '',
    departureDateTime: toKstInputValue(trip.departure_datetime),
    accommodations: (trip.accommodations ?? [])
      .slice()
      .sort((a, b) => a.check_in.localeCompare(b.check_in))
      .map((a) => ({ id: a.id, name: a.name, address: a.address ?? '', checkIn: a.check_in, checkOut: a.check_out })),
  })
  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }))
  const updateAcc = (index, patch) => update({ accommodations: form.accommodations.map((a, i) => (i === index ? { ...a, ...patch } : a)) })

  const datesValid = form.startDate && form.endDate && form.startDate <= form.endDate
  const accValid =
    form.accommodations.length > 0 &&
    form.accommodations.every((a) => a.name.trim() && a.checkIn && a.checkOut && a.checkIn <= a.checkOut && a.checkIn >= form.startDate && a.checkOut <= form.endDate)

  return (
    <Modal show onHide={busy ? undefined : onClose} centered scrollable>
      <Modal.Header>
        <Modal.Title as="h2" className="h5">
          {home.tripModalTitle}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        <Form.Label>{text.setupDates}</Form.Label>
        <div className="d-flex gap-2 mb-3">
          <Form.Control type="date" aria-label={text.startDate} disabled={busy} value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />
          <Form.Control type="date" aria-label={text.endDate} disabled={busy} min={form.startDate} value={form.endDate} onChange={(e) => update({ endDate: e.target.value })} />
        </div>

        <Form.Label>{text.accommodation}</Form.Label>
        {form.accommodations.map((acc, index) => (
          <Card key={acc.id ?? `new-${index}`} body className="mb-2">
            <Form.Control className="mb-2" placeholder={text.accommodationName} disabled={busy} value={acc.name} onChange={(e) => updateAcc(index, { name: e.target.value })} />
            <Form.Control className="mb-2" placeholder={text.accommodationAddress} disabled={busy} value={acc.address} onChange={(e) => updateAcc(index, { address: e.target.value })} />
            <div className="d-flex gap-2">
              <Form.Control type="date" aria-label={text.checkIn} disabled={busy} value={acc.checkIn} onChange={(e) => updateAcc(index, { checkIn: e.target.value })} />
              <Form.Control type="date" aria-label={text.checkOut} disabled={busy} min={acc.checkIn || undefined} value={acc.checkOut} onChange={(e) => updateAcc(index, { checkOut: e.target.value })} />
              {form.accommodations.length > 1 && (
                <Button variant="outline-danger" disabled={busy} onClick={() => update({ accommodations: form.accommodations.filter((_, i) => i !== index) })}>
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
          disabled={busy}
          onClick={() => update({ accommodations: [...form.accommodations, { id: null, name: '', address: '', checkIn: '', checkOut: '' }] })}
        >
          {text.addAccommodation}
        </Button>

        <Form.Label className="d-block">{text.departureFlight}</Form.Label>
        <div className="d-flex gap-2">
          <Form.Control placeholder="KE123" disabled={busy} value={form.departureFlight} onChange={(e) => update({ departureFlight: e.target.value })} />
          <Form.Control type="datetime-local" aria-label={text.departureDateTime} disabled={busy} value={form.departureDateTime} onChange={(e) => update({ departureDateTime: e.target.value })} />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" disabled={busy} onClick={onClose}>
          {home.cancel}
        </Button>
        <Button disabled={busy || !datesValid || !accValid} onClick={() => onSave(form)}>
          {busy ? home.saving : home.save}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}