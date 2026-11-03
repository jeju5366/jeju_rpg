import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap'
import { Link, useNavigate } from 'react-router-dom'
import AdventureCard from '../components/adventure/AdventureCard.jsx'
import DailyContextConfirmModal from '../components/adventure/DailyContextConfirmModal.jsx'
import { fetchDailyContextState, saveDailyContext } from '../services/supabase/dailyContextRepo.js'
import { ADVENTURE_RULES, TRAVEL_RANGES } from '../constants/gameBalance.js'
import { UI_TEXT } from '../constants/uiText.js'
import { generateAdventures, selectAdventure } from '../services/agent/adventureService.js'
import { fetchAdventures } from '../services/supabase/adventureRepo.js'
import { fetchLatestTrip } from '../services/supabase/tripService.js'
import { useAdventureStore } from '../store/adventureStore.js'
import { useAuthStore } from '../store/authStore.js'
import { useTripStore } from '../store/tripStore.js'
import { clampDate, listDays, todayKst } from '../utils/time.js'

export default function AdventurePage() {
  const text = UI_TEXT.adventure
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { trip, setTrip } = useTripStore()
  const { adventures, setAdventures, setCurrentAdventure } = useAdventureStore()

  const [tripLoaded, setTripLoaded] = useState(Boolean(trip))
  const [pickedDate, setPickedDate] = useState(null)
  const [pickedRange, setPickedRange] = useState(null)
  const [listLoading, setListLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [selectingId, setSelectingId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  // 그날의 일일 조건(동행/이동수단/종료 희망 시간). 확인(저장)하기 전에는 Agent 를 호출하지 않는다.
  const [dailyState, setDailyState] = useState(null) // { values, source, confirmed } | null(불러오는 중)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmError, setConfirmError] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  // 이동 범위 기본값: 여행 설정의 기본 이동 범위 → 없으면 'normal'
  const range = pickedRange ?? trip?.travel_range ?? 'normal'

  const errorMessage = (err) => text.errors[err.code] ?? err.message

  // 여행 정보 불러오기 (홈을 거치지 않고 들어온 경우)
  useEffect(() => {
    if (trip) return
    fetchLatestTrip(user.id)
      .then((latest) => setTrip(latest))
      .catch((err) => setError(err.message))
      .finally(() => setTripLoaded(true))
  }, [trip, user.id, setTrip])

  // 날짜 기본값: 오늘(여행 기간 밖이면 가장 가까운 여행일)
  const date = pickedDate ?? (trip ? clampDate(todayKst(), trip.start_date, trip.end_date) : null)

  const loadAdventures = useCallback(async () => {
    if (!trip || !date) return
    setListLoading(true)
    try {
      setAdventures(await fetchAdventures({ tripId: trip.id, adventureDate: date }))
    } catch (err) {
      setError(err.message)
    } finally {
      setListLoading(false)
    }
  }, [trip, date, setAdventures])

  useEffect(() => {
    loadAdventures()
  }, [loadAdventures])

  // 날짜가 바뀔 때마다 그날의 일일 조건 상태를 읽는다. (저장된 값 → 전날 값 → 여행 기본값)
  useEffect(() => {
    if (!trip || !date) return undefined
    let active = true
    fetchDailyContextState({ trip, date })
      .then((state) => active && setDailyState(state))
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
      setDailyState(null)
    }
  }, [trip, date])

  // "오늘의 모험 만들기": 그날 조건을 아직 확인하지 않았으면 Agent 를 부르기 전에 확인 단계를 먼저 보여준다.
  const handleCreateClick = () => {
    if (generating || !dailyState) return
    if (dailyState.confirmed) runGenerate()
    else {
      setConfirmError(null)
      setConfirmOpen(true)
    }
  }

  // 확인 모달의 시작 버튼: 최신 조건을 저장한 "다음에" 모험을 만든다. (저장 실패하면 Agent 를 호출하지 않는다)
  const handleConfirmStart = async (values) => {
    if (confirmBusy) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      await saveDailyContext({ userId: user.id, tripId: trip.id, date, values })
      setDailyState({ ...dailyState, values, source: 'saved', confirmed: true })
      setConfirmOpen(false)
    } catch (err) {
      setConfirmError(err.message)
      setConfirmBusy(false)
      return
    }
    setConfirmBusy(false)
    await runGenerate()
  }

  const runGenerate = async () => {
    if (generating) return
    setGenerating(true)
    setError(null)
    setNotice(null)
    try {
      const result = await generateAdventures({ tripId: trip.id, adventureDate: date, travelRange: range })
      // 기술적인 오류 문구는 화면에 내보내지 않는다. (원인 요약은 Agent Log 에 남는다)
      const degraded = result.meta?.places === 'mock' ? UI_TEXT.fallback.general : ''
      if (result.source === 'demo') setNotice(`${text.demoNotice} ${degraded}`.trim())
      else if (degraded) setNotice(degraded)
      await loadAdventures()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setGenerating(false)
    }
  }

  const handleSelect = async (adventure) => {
    if (selectingId) return
    setSelectingId(adventure.id)
    setError(null)
    try {
      setCurrentAdventure(await selectAdventure(adventure.id))
      // 새 모험을 골랐으니 퀘스트/홈 캐시를 다음 방문 때 다시 읽게 한다
      useAdventureStore.getState().invalidateBoard()
      useTripStore.getState().invalidateHub()
      navigate('/quest')
    } catch (err) {
      setError(errorMessage(err))
      setSelectingId(null)
    }
  }

  if (!tripLoaded) return <Spinner animation="border" />
  if (!trip) {
    return (
      <Alert variant="info">
        {text.noTrip} <Link to="/setup">{text.goSetup}</Link>
      </Alert>
    )
  }

  const selected = adventures.find((a) => a.status !== 'proposed')
  const latestSet = Math.max(0, ...adventures.map((a) => a.generation_set))
  const shown = selected ? [selected] : adventures.filter((a) => a.generation_set === latestSet)
  const canGenerate = !selected && latestSet < ADVENTURE_RULES.maxGenerationSets
  const days = listDays(trip.start_date, trip.end_date)

  return (
    <>
      <h1 className="h4 mb-3">{UI_TEXT.pages.adventure.title}</h1>

      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col xs={12} md={4}>
              <Form.Group controlId="adventure-date">
                <Form.Label>{text.date}</Form.Label>
                <Form.Select
                  value={date ?? ''}
                  disabled={generating}
                  onChange={(e) => {
                    setPickedDate(e.target.value)
                    setNotice(null)
                  }}
                >
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12} md={5}>
              <Form.Label className="d-block">{text.range}</Form.Label>
              <div className="d-flex gap-2">
                {TRAVEL_RANGES.map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={range === key ? 'success' : 'outline-secondary'}
                    disabled={generating || latestSet > 0}
                    onClick={() => setPickedRange(key)}
                  >
                    {text.ranges[key].label}
                  </Button>
                ))}
              </div>
            </Col>
            <Col xs={12} md={3}>
              {canGenerate ? (
                <Button className="w-100" disabled={generating || listLoading || !date || !dailyState} onClick={handleCreateClick}>
                  {generating
                    ? text.generating
                    : latestSet === 0
                      ? UI_TEXT.confirmed.createAdventure
                      : `${UI_TEXT.confirmed.findOtherAdventure} ${text.regenerateLeft}`}
                </Button>
              ) : (
                !selected && <div className="small text-muted">{text.limitReached}</div>
              )}
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && <Alert variant="warning">{notice}</Alert>}
      {selected && <h2 className="h6">{text.selectedTitle}</h2>}

      {confirmOpen && dailyState && (
        <DailyContextConfirmModal
          key={date}
          show
          initialValues={dailyState.values}
          source={dailyState.source}
          busy={confirmBusy}
          error={confirmError}
          onStart={handleConfirmStart}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {listLoading && !adventures.length ? (
        <Spinner animation="border" />
      ) : shown.length === 0 ? (
        <p className="text-muted">{text.empty}</p>
      ) : (
        <Row className="g-3">
          {shown.map((adventure) => (
            <Col key={adventure.id} xs={12} md={4}>
              <AdventureCard
                adventure={adventure}
                actionLabel={selected ? text.goQuest : text.start}
                busy={selectingId === adventure.id}
                disabled={generating || selectingId !== null}
                onAction={() => (selected ? navigate('/quest') : handleSelect(adventure))}
              />
            </Col>
          ))}
        </Row>
      )}
    </>
  )
}
