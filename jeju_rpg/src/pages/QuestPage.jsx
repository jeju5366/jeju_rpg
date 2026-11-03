import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, ListGroup, Spinner } from 'react-bootstrap'
import { Link, useNavigate } from 'react-router-dom'
import QuestRewardPopup from '../components/common/QuestRewardPopup.jsx'
import RewardNotice from '../components/common/RewardNotice.jsx'
import FinalQuestPanel from '../components/finalQuest/FinalQuestPanel.jsx'
import useFinalQuest from '../components/finalQuest/useFinalQuest.js'
import FreeTravelBanner from '../components/freeTravel/FreeTravelBanner.jsx'
import FreeTravelReturn from '../components/freeTravel/FreeTravelReturn.jsx'
import FreeTravelStartButton from '../components/freeTravel/FreeTravelStartButton.jsx'
import BonusOpportunity from '../components/quest/BonusOpportunity.jsx'
import ChapterAdvanceConfirmModal from '../components/quest/ChapterAdvanceConfirmModal.jsx'
import ChapterSection from '../components/quest/ChapterSection.jsx'
import NextChapterPreview from '../components/quest/NextChapterPreview.jsx'
import PhotoVerifyModal from '../components/quest/PhotoVerifyModal.jsx'
import QuestCard from '../components/quest/QuestCard.jsx'
import QuestLocationRow from '../components/quest/QuestLocationRow.jsx'
import useViewOnMap from '../components/map/useViewOnMap.js'
import ScheduleSuggestion from '../components/quest/ScheduleSuggestion.jsx'
import SurprisePrompt from '../components/quest/SurprisePrompt.jsx'
import { UI_TEXT } from '../constants/uiText.js'
import useGeolocation from '../hooks/useGeolocation.js'
import useQuestBoard from '../hooks/useQuestBoard.js'
import useRewardPopups from '../hooks/useRewardPopups.js'
import useScheduleAssistant from '../hooks/useScheduleAssistant.js'
import useSurprise from '../hooks/useSurprise.js'
import { advanceChapter } from '../services/agent/progressionService.js'
import { completeQuest, generateQuests, revealQuests } from '../services/agent/questService.js'
import { requestReplan } from '../services/agent/replanService.js'
import { fetchMemoryQuestIds } from '../services/supabase/memoryRepo.js'
import { useAdventureStore } from '../store/adventureStore.js'
import { useFreeTravelStore } from '../store/freeTravelStore.js'
import { useLocationStore } from '../store/locationStore.js'
import { usePhotoStore } from '../store/photoStore.js'
import { completeAndApply, createSingleFlight, shouldShowSurpriseOverlay } from '../utils/completionFlow.js'
import { chapterDestination } from '../utils/questLocation.js'
import { showsFinalQuest } from '../utils/finalQuestView.js'
import { shouldKeepPhotoBlob } from '../utils/photoMode.js'

export default function QuestPage() {
  const text = UI_TEXT.quest
  const progression = UI_TEXT.progression
  // 퀘스트 판은 store 캐시로 즉시 보여주고(탭 전환 때 spinner 없음), 오래됐을 때만 백그라운드로 다시 읽는다.
  const { trip, adventure: currentAdventure, chapters, quests, progress, loading, refreshing, error: boardError, reload } = useQuestBoard()

  const [generating, setGenerating] = useState(false)
  const [busyQuestId, setBusyQuestId] = useState(null)
  const [revealingId, setRevealingId] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [rewards, setRewards] = useState(null)
  const [gpsBusyQuestId, setGpsBusyQuestId] = useState(null)
  const [gpsFeedback, setGpsFeedback] = useState(null) // { questId, kind, message } — 방금 시도한 GPS 인증 안내
  const freePhase = useFreeTravelStore((s) => s.phase)
  const [photoQuest, setPhotoQuest] = useState(null) // 사진 인증 모달이 열려 있는 퀘스트
  const [memoryIds, setMemoryIds] = useState(() => new Set()) // 추억으로 저장된 퀘스트
  const [nextTravelMinutes, setNextTravelMinutes] = useState(null)
  const [replanBusy, setReplanBusy] = useState(false)
  const [replanMessage, setReplanMessage] = useState(null)
  const [noAlt, setNoAlt] = useState(false) // REPLAN 인데 실제 대체 후보가 없을 때
  const [bonusMessage, setBonusMessage] = useState(null)
  const keepPhoto = usePhotoStore((s) => s.keep)
  const rewardPopups = useRewardPopups()
  const completionFlight = useRef(createSingleFlight()).current // 같은 틱의 연타 방어(서버의 idempotency 와 별개로 화면에서 먼저 막는다)
  const { locateAccurate } = useGeolocation()
  const navigate = useNavigate()
  const viewOnMap = useViewOnMap()
  const finalQuest = useFinalQuest() // 마지막 날에만 서버에 묻고 TTL 로 캐시한다

  // 퀘스트 완료 성공 직후, 서버가 확정한 지급 결과로 EXP 결과 팝업을 띄운다. (카드가 compact 로 바뀌는 reload 보다 먼저 호출된다)
  // 새로 지급된 EXP 가 없는 경우(이미 받은 보상 등)에만 기존 RewardNotice 안내로 대신한다.
  const showQuestReward = (quest, result) => {
    if (!rewardPopups.show(quest, result)) setRewards({ questExp: result.rewards?.quest, discovery: null, levelUps: [] })
  }

  // 완료 성공 직후 화면 캐시에 결과를 바로 반영한다. (서버 응답의 progress/chapterStatus 를 그대로 쓴다. 실패 응답에서는 호출되지 않는다)
  const applyLocal = (quest, result) => useAdventureStore.getState().applyCompletion({ progress: result.progress, chapterId: quest.chapter_id, chapterStatus: result.chapterStatus })
  // background 새로고침이 실패해도 완료 UI 는 되돌리지 않는다. 캐시를 "오래된 것"으로만 표시해 다음 갱신 때 다시 맞춘다.
  const markStale = () => useAdventureStore.getState().invalidateBoard()

  const errorMessage = (err) => text.errors[err.code] ?? UI_TEXT.schedule.surprise.errors[err.code] ?? err.message

  const questIdsKey = quests.map((q) => q.id).join(',')
  // 추억 표시는 부가 정보라서 실패해도(009 미적용 등) 퀘스트 화면은 그대로 쓴다.
  useEffect(() => {
    if (!quests.length) return
    fetchMemoryQuestIds(quests.map((q) => q.id)).then(setMemoryIds).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questIdsKey])

  // ───────── 파생 상태 ─────────
  const progressByQuestId = new Map(progress.map((p) => [p.quest_id, p]))
  const completedIds = new Set(progress.filter((p) => p.status === 'completed').map((p) => p.quest_id))
  const mainQuest = quests.find((q) => q.quest_type === 'main')
  const current = chapters.find((c) => c.status === 'active' || c.status === 'core_completed') ?? null
  const currentQuests = current ? quests.filter((q) => q.chapter_id === current.id) : []
  const currentCore = currentQuests.find((q) => q.quest_type === 'core') ?? null
  const nextChapter = chapters.filter((c) => c.status === 'locked' || c.status === 'available').sort((a, b) => a.seq - b.seq)[0] ?? null
  const nextCore = nextChapter ? quests.find((q) => q.chapter_id === nextChapter.id && q.quest_type === 'core') : null
  const freeActive = freePhase === 'active' || freePhase === 'reviewing'
  const coreDone = current?.status === 'core_completed'
  const remainingOptional = currentQuests.filter((q) => q.quest_type === 'optional' && !q.is_hidden && !completedIds.has(q.id)).length
  const hiddenOptional = currentQuests.filter((q) => q.quest_type === 'optional' && q.is_hidden).length
  const transport = trip?.transport

  // ───────── 일정 판단(코드) + 돌발 퀘스트 ─────────
  const assistant = useScheduleAssistant({ trip, adventure: currentAdventure, chapters, quests, nextTravelMinutes, enabled: Boolean(currentAdventure) && freePhase === 'idle' })
  const replanNeeded = Boolean(assistant.suggestion) || replanBusy
  const surprise = useSurprise({
    adventure: currentAdventure,
    current,
    currentCore,
    quests,
    daily: assistant.daily,
    replanNeeded,
    verificationOpen: photoQuest !== null || gpsBusyQuestId !== null,
    transitioning: advancing || confirmOpen,
    freeTravel: freeActive,
    reload,
  })

  // 안정적인 시점에서만 돌발 퀘스트를 평가한다: 이 화면에서 핵심 퀘스트가 막 완료됐을 때 / 챕터의 선택 퀘스트까지 모두 끝냈을 때(다음 챕터로 가기 전)
  const prevCore = useRef({ done: coreDone, remaining: remainingOptional, chapterId: current?.id })
  useEffect(() => {
    const before = prevCore.current
    prevCore.current = { done: coreDone, remaining: remainingOptional, chapterId: current?.id }
    if (!current || before.chapterId !== current.id) return
    if (!before.done && coreDone) surprise.evaluate(remainingOptional === 0 ? 'chapter_completed' : 'core_completed')
    else if (before.done && coreDone && before.remaining > 0 && remainingOptional === 0) surprise.evaluate('chapter_completed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreDone, remainingOptional, current?.id])

  // 자유여행에서 돌아오면 날씨 캐시를 확인한다(만료됐을 때만 실제로 가져온다)
  const prevPhase = useRef(freePhase)
  useEffect(() => {
    const before = prevPhase.current
    prevPhase.current = freePhase
    if (before !== freePhase && (freePhase === 'returning' || freePhase === 'idle')) {
      reload().catch(() => {})
      if (before === 'returning' || before === 'active' || before === 'reviewing') assistant.refreshWeather()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freePhase])

  // ───────── 핸들러 ─────────
  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    setError(null)
    setNotice(null)
    try {
      const result = await generateQuests(currentAdventure.id)
      if (result.source === 'demo') setNotice(text.demoNotice) // 기술적인 원인은 화면에 내보내지 않는다 (Agent Log 에 요약)
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setGenerating(false)
    }
  }

  const handleComplete = async (quest) => {
    await completionFlight(async () => {
      setBusyQuestId(quest.id)
      setError(null)
      setRewards(null)
      try {
        // 완료 API 성공 → 로컬 완료 상태 + 보상 팝업 즉시 → 버튼 busy 즉시 해제 → 전체 reload 는 background
        await completeAndApply({
          call: () => completeQuest(quest.id),
          apply: (result) => applyLocal(quest, result),
          announce: (result) => showQuestReward(quest, result),
          refresh: reload,
          onRefreshError: markStale,
        })
      } catch (err) {
        setError(errorMessage(err)) // 실패: 완료 처리/팝업 없음
        reload().catch(() => {}) // 이미 처리된 경우 등 서버 기록 기준으로 화면을 맞춘다 (기다리지 않는다)
      } finally {
        setBusyQuestId(null)
      }
    })
  }

  // GPS 위치 인증: 위치 확인(정확도가 나아질 때까지 잠깐 대기) → 서버가 거리/정확도 검증 → 성공하면 기존 완료 흐름(EXP/방문/발견)이 이어진다.
  // 정확도 부족은 실패가 아니라 "다시 확인" 안내다. 권한 거부/반복 실패여도 같은 카드의 "직접 확인으로 완료"로 진행할 수 있다.
  const handleGpsComplete = async (quest) => {
    if (gpsBusyQuestId || busyQuestId) return
    await completionFlight(async () => {
      setGpsBusyQuestId(quest.id)
      setGpsFeedback(null)
      setError(null)
      setRewards(null)
      try {
        const located = await locateAccurate()
        if (!located.ok) {
          setGpsFeedback({ questId: quest.id, kind: located.error, message: UI_TEXT.location.errors[located.error] ?? UI_TEXT.location.errors.position_unavailable })
          return
        }
        await completeAndApply({
          call: () => completeQuest(quest.id, { method: 'gps', position: located.position }),
          apply: (result) => applyLocal(quest, result), // gps_photo 의 GPS 단계만 끝났다면 중간 인증 상태(progress)만 반영된다
          announce: (result) => {
            // gps_photo: 위치 인증만 끝났다. 아직 완료가 아니고 EXP 도 없다. 사진 인증을 마저 하면 완료된다.
            if (result.pending) setNotice(UI_TEXT.photo.awaitingPhoto)
            else showQuestReward(quest, result)
          },
          refresh: reload,
          onRefreshError: markStale,
        })
      } catch (err) {
        const gps = UI_TEXT.gps
        const feedback = {
          gps_accuracy_low: { kind: 'accuracy_low', message: gps.accuracyLow },
          gps_too_far: { kind: 'too_far', message: gps.tooFar(Math.round(err.details?.distanceMeters ?? 0)) },
          gps_position_stale: { kind: 'stale', message: gps.stale },
          gps_position_invalid: { kind: 'invalid', message: gps.invalid },
        }[err.code]
        if (feedback) setGpsFeedback({ questId: quest.id, ...feedback })
        else {
          setError(errorMessage(err))
          reload().catch(() => {})
        }
      } finally {
        setGpsBusyQuestId(null)
      }
    })
  }

  // 사진 인증 모달이 인증 결과를 알려줄 때: 완료(EXP/발견)면 보상을 보여주고, 인증 사진은 "추억으로 남기기"를 위해 메모리에만 잠깐 들고 있는다.
  const handlePhotoVerified = (result, blob) => {
    setError(null)
    setNotice(null)
    // 사진이 통과한 순간(완료든 gps_photo 의 GPS 대기든) 인증 사진을 메모리에만 잠깐 보관한다. 이후 GPS 로 완료돼도 "추억으로 남기기"를 쓸 수 있다.
    if (shouldKeepPhotoBlob(result)) keepPhoto(photoQuest.id, blob)
    if (result.completed) {
      applyLocal(photoQuest, result) // 서버가 확정한 완료 결과를 즉시 반영
      showQuestReward(photoQuest, result)
    } else if (result.awaiting === 'gps') {
      setNotice(UI_TEXT.photo.awaitingGps)
    }
    reload().catch(markStale) // 전체 새로고침은 background (모달/버튼이 기다리지 않는다)
  }

  // 사진 인증 fallback: 사진만으로 확인이 어려우면 직접 완료 확인(self)으로 같은 완료 흐름을 쓴다.
  const handlePhotoSelfConfirm = async (quest) => {
    await completionFlight(async () => {
      try {
        await completeAndApply({
          call: () => completeQuest(quest.id),
          apply: (result) => applyLocal(quest, result),
          announce: (result) => showQuestReward(quest, result),
          refresh: reload,
          onRefreshError: markStale,
        })
      } catch (err) {
        setError(errorMessage(err))
        reload().catch(() => {})
      }
    })
  }

  const handleReveal = async (chapter) => {
    if (revealingId) return
    setRevealingId(chapter.id)
    setError(null)
    try {
      await revealQuests(chapter.id)
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRevealingId(null)
    }
  }

  const handleAdvance = async (chapter) => {
    if (advancing) return
    setAdvancing(true)
    setError(null)
    setRewards(null)
    try {
      const result = await advanceChapter(chapter.id)
      setRewards({ chapterBonus: result.rewards.chapterBonus, adventureBonus: result.rewards.adventureBonus })
      setConfirmOpen(false)
      await reload() // 같은 영역에 다음 챕터 내용이 나타난다
      assistant.refreshWeather() // 챕터 전환: 날씨 캐시가 만료됐을 때만 실제로 가져온다
    } catch (err) {
      setError(errorMessage(err))
      setConfirmOpen(false)
    } finally {
      setAdvancing(false)
    }
  }

  // REPLAN: 사용자가 [일정 다시 맞추기]를 승인했을 때만 호출한다. (승인 1회 = REPLAN 1회)
  const handleApprove = async (suggestion) => {
    if (replanBusy) return
    setReplanBusy(true)
    setReplanMessage(null)
    setNoAlt(false)
    setError(null)
    try {
      const position = useLocationStore.getState().position
      const result = await requestReplan({
        adventureId: currentAdventure.id,
        reason: suggestion.reason,
        context: position ? { position: { lat: position.lat, lng: position.lng } } : undefined,
      })
      if (result.status === 'replanned') {
        assistant.afterReplan(suggestion.reason)
        setNotice(UI_TEXT.schedule.done)
        await reload()
      } else if (result.status === 'no_alternative') {
        setNoAlt(true) // 실제 대체 후보가 없다: 기존 퀘스트 유지 / 챕터 건너뛰기 / 자유여행 3가지를 보여준다
      } else {
        assistant.dismissSuggestion(suggestion.reason)
        setNotice(UI_TEXT.schedule.unchanged)
      }
    } catch (err) {
      // 실패해도 기존 모험은 그대로다. 아무것도 지워지지 않는다.
      const base = UI_TEXT.schedule.errors[err.code] ?? UI_TEXT.schedule.failed
      setReplanMessage(err.code === 'replan_cooldown' && err.details?.retryAfterMinutes ? `${base} (약 ${err.details.retryAfterMinutes}분 뒤)` : base)
    } finally {
      setReplanBusy(false)
    }
  }

  const handleBonusSurprise = async () => {
    setBonusMessage(null)
    const result = await surprise.evaluate('ahead_of_schedule')
    if (!result?.offered) setBonusMessage(UI_TEXT.schedule.bonus.noSurprise)
  }

  const handleSurpriseRespond = async (quest, action) => {
    try {
      await surprise.respond(quest, action)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  // Final Quest 가 시작됐으면(또는 결항 상태면) 일반 퀘스트 판은 닫혀 있다. 완료한 퀘스트/EXP/추억은 그대로 남는다.
  if (showsFinalQuest(finalQuest.state) || finalQuest.state?.status === 'flight_cancelled') {
    return (
      <>
        <h1 className="h4 mb-3">{UI_TEXT.pages.quest.title}</h1>
        <FinalQuestPanel fq={finalQuest} onEditFlight={() => navigate('/')} />
        <div className="small text-muted">{UI_TEXT.finalQuest.quest.locked} {UI_TEXT.finalQuest.quest.doneKept}</div>
      </>
    )
  }

  if (loading) {
    return (
      <div className="small text-muted py-3">
        <Spinner animation="border" size="sm" /> {UI_TEXT.map.loading.replace('지도를', '퀘스트를')}
      </div>
    )
  }
  if (!currentAdventure) {
    return (
      <>
        {(error || boardError) && <Alert variant="danger">{error ?? boardError}</Alert>}
        <Alert variant="info">
          {text.noAdventure} <Link to="/adventure">{text.goAdventure}</Link>
        </Alert>
      </>
    )
  }

  const busy = generating || busyQuestId !== null || gpsBusyQuestId !== null || revealingId !== null || advancing || replanBusy || freeActive
  const adventureDone = currentAdventure.status === 'completed'
  const isLast = current ? current.seq === chapters.length : false

  // 챕터 이동 버튼 1개 + 확인 모달 모드
  const modalMode = !coreDone ? 'skip' : remainingOptional > 0 ? 'remaining' : 'allDone'
  const advanceButton = {
    label: !coreDone ? progression.skipChapter : isLast ? progression.finishAdventure : progression.nextChapter,
    variant: coreDone ? 'primary' : 'outline-secondary',
    onClick: () => setConfirmOpen(true),
  }

  const acceptedSurprises = surprise.accepted.filter((q) => !completedIds.has(q.id))

  return (
    <div className={current ? 'quest-page--has-action' : undefined}>
      <h1 className="h4 mb-3">
        {UI_TEXT.pages.quest.title} {refreshing && <Spinner animation="border" size="sm" className="ms-1" />}
      </h1>

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex gap-1 mb-1">
            <Badge bg="dark">{text.main}</Badge>
            <Badge bg={adventureDone ? 'success' : 'primary'}>{text.status[currentAdventure.status] ?? currentAdventure.status}</Badge>
          </div>
          <Card.Title as="h2" className="h5">
            {mainQuest?.title ?? currentAdventure.title}
          </Card.Title>
          <Card.Text className="mb-0">{mainQuest?.description ?? currentAdventure.summary}</Card.Text>
          {adventureDone && <div className="mt-2 fw-bold">🎉 {text.adventureDone}</div>}
        </Card.Body>
      </Card>

      <FinalQuestPanel fq={finalQuest} />
      <FreeTravelBanner />
      {freePhase === 'returning' && <FreeTravelReturn />}
      {(error || boardError) && <Alert variant="danger">{error ?? boardError}</Alert>}
      {notice && (
        <Alert variant="warning" dismissible onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <RewardNotice rewards={rewards} onClose={() => setRewards(null)} />
      <QuestRewardPopup queue={rewardPopups.queue} onClose={rewardPopups.close} />

      {/* REPLAN 제안(사용자 승인 필요) / 일정이 빨라졌을 때의 추가 콘텐츠 제안 / 돌발 퀘스트 제안 */}
      {assistant.suggestion && (
        <ScheduleSuggestion
          suggestion={assistant.suggestion}
          adventureId={currentAdventure.id}
          busy={replanBusy}
          message={replanMessage}
          noAlt={noAlt}
          onKeep={() => {
            setReplanMessage(null)
            assistant.dismissSuggestion(assistant.suggestion.reason)
          }}
          onApprove={() => handleApprove(assistant.suggestion)}
          onNoAltKeep={() => {
            setNoAlt(false)
            assistant.dismissSuggestion(assistant.suggestion.reason)
          }}
          onNoAltSkip={() => {
            setNoAlt(false)
            setConfirmOpen(true)
          }}
        />
      )}
      {!assistant.suggestion && assistant.bonus && (
        <BonusOpportunity
          aheadMinutes={assistant.bonus.aheadMinutes}
          hiddenCount={hiddenOptional}
          adventureId={currentAdventure.id}
          busy={busy}
          message={bonusMessage}
          onMore={() => current && handleReveal(current)}
          onSurprise={handleBonusSurprise}
          onDismiss={assistant.dismissBonus}
        />
      )}
      {shouldShowSurpriseOverlay({ offered: surprise.offered, rewardQueueLength: rewardPopups.queue.length, replanNeeded, verificationOpen: photoQuest !== null || gpsBusyQuestId !== null, freeActive }) && (
        <SurprisePrompt quest={surprise.offered} onRespond={handleSurpriseRespond} />
      )}

      {chapters.length === 0 ? (
        <Card>
          <Card.Body>
            <Card.Text>{text.ready}</Card.Text>
            <Button disabled={generating} onClick={handleGenerate}>
              {generating ? text.generating : text.generate}
            </Button>
          </Card.Body>
        </Card>
      ) : current ? (
        <>
          <details className="small text-muted mb-2">
            <summary>{UI_TEXT.questLayout.helpTitle}</summary>
            {text.selfNote}
          </details>
          <ChapterSection
            key={current.id}
            chapter={current}
            position={{ index: current.seq, total: chapters.length }}
            quests={currentQuests}
            completedIds={completedIds}
            busyQuestId={busyQuestId}
            gpsBusyQuestId={gpsBusyQuestId}
            gpsFeedback={gpsFeedback}
            activeQuestId={photoQuest?.id ?? null}
            progressByQuestId={progressByQuestId}
            memoryIds={memoryIds}
            revealing={revealingId === current.id}
            disabled={busy}
            advance={advanceButton}
            location={<QuestLocationRow destination={chapterDestination(currentQuests)} transport={transport} />}
            onViewMap={viewOnMap}
            preview={
              nextCore?.place_name ? (
                <NextChapterPreview
                  from={currentCore?.place_lat != null ? { lat: currentCore.place_lat, lng: currentCore.place_lng } : null}
                  to={nextCore.place_lat != null ? { name: nextCore.place_name, lat: nextCore.place_lat, lng: nextCore.place_lng } : { name: nextCore.place_name }}
                  transport={transport}
                  onEstimate={(estimate) => setNextTravelMinutes(estimate.minutes)}
                />
              ) : null
            }
            onComplete={handleComplete}
            onGpsComplete={handleGpsComplete}
            onPhoto={(quest) => setPhotoQuest(quest)}
            onReveal={handleReveal}
          />

          {/* 수락한 돌발 퀘스트: 챕터 진행과 별개로 언제든 할 수 있다 */}
          {acceptedSurprises.length > 0 && (
            <div className="mb-3">
              <div className="fw-bold mb-1">⚡ {UI_TEXT.schedule.surprise.section}</div>
              <div className="small text-muted mb-1">{UI_TEXT.schedule.surprise.acceptedHint}</div>
              {acceptedSurprises.map((quest) => (
                <QuestCard
                  key={quest.id}
                  quest={quest}
                  progress={progressByQuestId.get(quest.id) ?? null}
                  completed={false}
                  canComplete
                  busy={busyQuestId === quest.id}
                  gpsBusy={gpsBusyQuestId === quest.id}
                  gpsFeedback={gpsFeedback?.questId === quest.id ? gpsFeedback : null}
                  memorySaved={memoryIds.has(quest.id)}
                  disabled={busy}
                  onComplete={() => handleComplete(quest)}
                  onGpsComplete={() => handleGpsComplete(quest)}
                  onPhoto={() => setPhotoQuest(quest)}
                />
              ))}
            </div>
          )}

          {currentAdventure.status === 'active' && (
            <div className="mb-3">
              <FreeTravelStartButton adventureId={currentAdventure.id} disabled={busy} className="w-100" />
            </div>
          )}
          {photoQuest && (
            <PhotoVerifyModal
              quest={photoQuest}
              progress={progressByQuestId.get(photoQuest.id) ?? null}
              onClose={() => setPhotoQuest(null)}
              onVerified={handlePhotoVerified}
              onSelfConfirm={handlePhotoSelfConfirm}
            />
          )}
          <ChapterAdvanceConfirmModal
            show={confirmOpen}
            mode={modalMode}
            isLast={isLast}
            busy={advancing}
            onStay={() => setConfirmOpen(false)}
            onConfirm={() => handleAdvance(current)}
          />
        </>
      ) : (
        // 모든 챕터가 닫힌 뒤: 퀘스트 카드 없이 챕터별 결과만 요약한다.
        <Card>
          <Card.Body>
            <Card.Title as="h2" className="h6">
              {progression.summaryTitle}
            </Card.Title>
            <ListGroup variant="flush">
              {chapters.map((chapter) => (
                <ListGroup.Item key={chapter.id} className="d-flex justify-content-between">
                  <span>
                    {progression.chapterOf} {chapter.seq} · {chapter.title}
                  </span>
                  <Badge bg={chapter.status === 'completed' ? 'success' : 'secondary'}>{text.chapterStatus[chapter.status] ?? chapter.status}</Badge>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Card.Body>
        </Card>
      )}
    </div>
  )
}
