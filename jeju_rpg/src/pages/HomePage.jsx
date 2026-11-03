import { useState } from 'react'
import { Alert, Button, Card, Spinner } from 'react-bootstrap'
import { Link, useNavigate } from 'react-router-dom'
import ApiDebugPanel from '../components/common/ApiDebugPanel.jsx'
import FinalQuestPanel from '../components/finalQuest/FinalQuestPanel.jsx'
import useFinalQuest from '../components/finalQuest/useFinalQuest.js'
import DailyContextEditModal from '../components/home/DailyContextEditModal.jsx'
import ReplanSuggestion from '../components/home/ReplanSuggestion.jsx'
import TripInfoEditModal from '../components/home/TripInfoEditModal.jsx'
import TripSummaryCard from '../components/home/TripSummaryCard.jsx'
import useTripHub from '../components/home/useTripHub.js'
import { UI_TEXT } from '../constants/uiText.js'
import { requestReplan } from '../services/agent/replanService.js'
import { saveDailyContext, setReplanPending } from '../services/supabase/dailyContextRepo.js'
import { updateTripInfo } from '../services/supabase/tripService.js'
import { accommodationChanged, accommodationForDate, changedDailyFields } from '../utils/dailyContext.js'

// 홈: 이번 여행 정보 허브.
// ⚠ 이 화면에서 정보를 고치는 동작(여행 정보 수정 / 오늘 조건 수정)은 모두 "DB 저장만" 한다. Agent 는 호출하지 않는다.
//    오늘 진행 중인 모험이 있을 때 일정에 영향을 주는 값이 바뀌면 "재계획 제안"만 띄우고,
//    사용자가 "오늘 일정 다시 맞추기"를 직접 누를 때 한 번만 REPLAN 을 요청한다.
export default function HomePage() {
  const text = UI_TEXT.home
  const hub = useTripHub()
  const navigate = useNavigate()
  const finalQuest = useFinalQuest()
  const { user, trip, date, daily, adventure } = hub
  const [modal, setModal] = useState(null) // 'trip' | 'daily' | null
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [replanBusy, setReplanBusy] = useState(false)
  const [replanMessage, setReplanMessage] = useState(null)

  const closeModal = () => {
    if (saving) return
    setModal(null)
    setModalError(null)
  }

  // 오늘 조건(동행/이동수단/종료 희망 시간) 저장
  const handleSaveDaily = async (values) => {
    if (saving) return
    setSaving(true)
    setModalError(null)
    try {
      // 오늘의 모험이 이미 있고 일정에 영향을 주는 값이 바뀌었으면 재계획 제안을 남긴다. (호출은 하지 않는다)
      const changed = changedDailyFields(daily.values, values).length > 0
      await saveDailyContext({ userId: user.id, tripId: trip.id, date, values, replanPending: changed && adventure ? true : undefined })
      await hub.reloadToday()
      setModal(null)
      setNotice(text.saved)
    } catch (err) {
      setModalError(text.errors[err.message] ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  // 여행 전체 정보(기간/숙소/항공편) 저장
  const handleSaveTrip = async (form) => {
    if (saving) return
    setSaving(true)
    setModalError(null)
    try {
      const before = accommodationForDate(trip.accommodations ?? [], date).today
      await updateTripInfo(trip.id, form)
      const latest = await hub.reloadTrip()
      const after = accommodationForDate(latest.accommodations ?? [], date).today
      // 오늘 숙소가 바뀌었고 오늘의 모험이 있으면 재계획 제안을 남긴다. (호출은 하지 않는다)
      if (adventure && accommodationChanged(before, after)) {
        await saveDailyContext({ userId: user.id, tripId: trip.id, date, values: daily.values, replanPending: true })
      }
      await hub.reloadToday()
      setModal(null)
      setNotice(text.saved)
    } catch (err) {
      setModalError(text.errors[err.message] ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReplanLater = async () => {
    setReplanBusy(true)
    try {
      await setReplanPending({ tripId: trip.id, date, pending: false })
      setReplanMessage(null)
      await hub.reloadToday()
    } catch (err) {
      hub.setError(err.message)
    } finally {
      setReplanBusy(false)
    }
  }

  // "오늘 일정 다시 맞추기": 사용자가 직접 눌렀을 때만 REPLAN_ADVENTURE 요청
  const handleReplanNow = async () => {
    if (replanBusy) return
    setReplanBusy(true)
    setReplanMessage(null)
    try {
      await requestReplan({ adventureId: adventure.id })
      await setReplanPending({ tripId: trip.id, date, pending: false })
      await hub.reloadToday()
    } catch (err) {
      setReplanMessage(err.code === 'replan_not_implemented' ? UI_TEXT.replan.notReady : (UI_TEXT.replan.errors[err.code] ?? err.message))
    } finally {
      setReplanBusy(false)
    }
  }

  if (hub.tripLoading) return <Spinner animation="border" />
  if (!trip) {
    return (
      <Card>
        <Card.Body>
          <Card.Title as="h1" className="h4">
            {text.tripTitle}
          </Card.Title>
          <Card.Text>{text.noTrip}</Card.Text>
        </Card.Body>
      </Card>
    )
  }

  const showReplan = Boolean(adventure && daily?.saved?.replan_pending)
  const fqState = finalQuest.state
  const finalLocked = Boolean(fqState?.locked) || fqState?.status === 'flight_cancelled'

  // 끝난 여행: 새 모험을 만들거나 다시 진행하지 않는다. 기록 보기 / 새 여행 시작만 제안한다.
  if (trip.status === 'completed') {
    const done = UI_TEXT.finalQuest.home
    return (
      <Card className="mb-3">
        <Card.Body>
          <Card.Title as="h1" className="h5">
            {done.completedTitle}
          </Card.Title>
          <Card.Text>{done.completedBody}</Card.Text>
          <div className="d-flex gap-2">
            <Button variant="primary" className="flex-fill" onClick={() => navigate(`/summary/${trip.id}`)}>
              {done.viewRecord}
            </Button>
            <Button variant="outline-primary" className="flex-fill" onClick={() => navigate('/setup')}>
              {done.newTrip}
            </Button>
          </div>
        </Card.Body>
      </Card>
    )
  }

  return (
    <>
      {hub.error && <Alert variant="danger">{hub.error}</Alert>}
      {notice && (
        <Alert variant="success" dismissible onClose={() => setNotice(null)} className="small">
          {notice}
        </Alert>
      )}
      <FinalQuestPanel fq={finalQuest} onEditFlight={() => setModal('trip')} />
      {showReplan && !finalLocked && <ReplanSuggestion busy={replanBusy} message={replanMessage} onLater={handleReplanLater} onNow={handleReplanNow} />}

      <TripSummaryCard
        trip={trip}
        date={date}
        daily={daily}
        onEditTrip={() => setModal('trip')}
        onEditDaily={() => setModal('daily')}
      />
      {!finalLocked && (
        <Button as={Link} to="/adventure" className="w-100 mb-3">
          {UI_TEXT.confirmed.createAdventure}
        </Button>
      )}

      {modal === 'trip' && <TripInfoEditModal trip={trip} busy={saving} error={modalError} onSave={handleSaveTrip} onClose={closeModal} />}
      {modal === 'daily' && daily && <DailyContextEditModal initialValues={daily.values} busy={saving} error={modalError} onSave={handleSaveDaily} onClose={closeModal} />}

      {import.meta.env.DEV && <ApiDebugPanel />}
    </>
  )
}