import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Spinner } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { verifyQuestPhoto } from '../../services/verification/photoService.js'
import { resizeImageFile } from '../../utils/imageResize.js'
import { photoAttemptState, photoModeOf } from '../../utils/photoMode.js'
import MemoryButton from './MemoryButton.jsx'

// 사진 인증 모달. 사진 선택(카메라/갤러리) → 미리보기 → "이 사진으로 인증" → 결과.
//   · 사진은 업로드 전에 브라우저에서 줄인다(resizeImageFile). 인증용 사진은 서버에 저장되지 않는다.
//   · 사진을 고를 때마다 attemptId 를 새로 만든다. 같은 사진을 다시 보내도 서버가 AI 를 다시 부르지 않고, 연타는 busy 로 한 번만 보낸다.
//   · uncertain / fail → 재촬영 안내 → 2회째도 통과 못 하면(또는 AI 장애가 계속되면) [다시 돌아가기] / [직접 완료 확인] fallback.
//   · 성공하면 "인증 완료!" 와 함께 [☆ 추억으로 남기기] 를 보여준다. 남기지 않아도 퀘스트는 완료 상태 그대로다.
// props: quest / progress(quest_progress 행) / onClose / onVerified(result, blob) — 인증 결과를 페이지가 반영 / onSelfConfirm(quest) — 직접 완료 확인
export default function PhotoVerifyModal({ quest, progress, onClose, onVerified, onSelfConfirm }) {
  const text = UI_TEXT.photo.modal
  const mode = photoModeOf(quest)
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)

  const [photo, setPhoto] = useState(null) // { blob, url, attemptId }
  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null) // { kind: 'fail'|'uncertain'|'pass'|'awaiting_gps'|'error'|'busy', reason, info }
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(() => photoAttemptState(progress)) // { attemptsLeft, exhausted ... } 서버가 돌려주는 값으로 갱신
  const [selfBusy, setSelfBusy] = useState(false)
  const sendingRef = useRef(false) // 연타 방지: state 는 다음 렌더에야 바뀌므로 ref 로 즉시 잠근다

  // 미리보기 주소 정리
  useEffect(() => () => photo?.url && URL.revokeObjectURL(photo.url), [photo])

  const pick = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // 같은 파일을 다시 골라도 change 가 일어나게
    if (!file) return
    setPreparing(true)
    setError(null)
    setOutcome(null)
    try {
      const { blob } = await resizeImageFile(file)
      setPhoto({ blob, url: URL.createObjectURL(blob), attemptId: crypto.randomUUID() })
    } catch {
      setError(text.readFailed)
    } finally {
      setPreparing(false)
    }
  }

  const submit = async () => {
    if (!photo || sendingRef.current) return // 연타 방지: 진행 중에는 다시 보내지 않는다
    sendingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await verifyQuestPhoto({ questId: quest.id, attemptId: photo.attemptId, blob: photo.blob })
      setInfo({ ...result.photo, exhausted: result.photo.canFallback })
      if (result.result === 'pass') {
        setOutcome({ kind: result.completed ? 'pass' : 'awaiting_gps', reason: result.reason })
        onVerified(result, photo.blob) // 완료(EXP/발견)·진행 상태를 페이지에 반영
      } else {
        setOutcome({ kind: result.result, reason: result.reason })
      }
    } catch (err) {
      const state = err.details?.photo
      if (state) setInfo({ ...state, exhausted: state.canFallback })
      if (err.code === 'photo_attempts_exhausted') setInfo((prev) => ({ ...prev, exhausted: true, attemptsLeft: 0 }))
      else if (err.code === 'photo_busy') setOutcome({ kind: 'busy' })
      else if (err.code === 'photo_ai_failed') setOutcome({ kind: 'error' })
      else setError(UI_TEXT.quest.errors[err.code] ?? err.message)
    } finally {
      sendingRef.current = false
      setBusy(false)
    }
  }

  const confirmSelf = async () => {
    if (selfBusy) return
    setSelfBusy(true)
    try {
      await onSelfConfirm(quest)
      onClose()
    } finally {
      setSelfBusy(false)
    }
  }

  const done = outcome?.kind === 'pass'
  const awaitingGps = outcome?.kind === 'awaiting_gps'
  // 사진 AI 를 다 썼거나(2회 판정/2회 장애) 서버가 거절하면 직접 확인 fallback 을 보여준다.
  const showFallback = mode === 'ai_check' && info.exhausted && !done && !awaitingGps
  const canPick = !busy && !preparing && !done && !awaitingGps && !showFallback

  return (
    <Modal show onHide={busy ? undefined : onClose} centered>
      <Modal.Header>
        <Modal.Title as="h2" className="h5">
          📷 {done ? text.passTitle : UI_TEXT.photo.modal.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="fw-bold">{quest.title}</div>
        <div className="small text-muted mb-2">{quest.description}</div>

        {/* 사진 선택: 일반 file input 이라 휴대폰에서는 카메라 촬영/갤러리 선택이 자연스럽게 열린다 */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={pick} />

        {photo && !done && (
          <div className="mb-2 text-center">
            <img src={photo.url} alt={text.preview} style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8 }} />
          </div>
        )}
        {preparing && (
          <div className="small text-muted mb-2">
            <Spinner animation="border" size="sm" /> {text.preparing}
          </div>
        )}
        {error && (
          <Alert variant="danger" className="small py-2">
            {error}
          </Alert>
        )}

        {/* 결과 */}
        {outcome && (outcome.kind === 'fail' || outcome.kind === 'uncertain') && (
          <Alert variant="warning" className="small py-2">
            <div className="fw-bold">{outcome.kind === 'fail' ? text.resultFail : text.resultUncertain}</div>
            {outcome.reason && <div>{outcome.reason}</div>}
            {!showFallback && (
              <div>
                {text.retake} {text.attemptsLeft(info.attemptsLeft)}
              </div>
            )}
          </Alert>
        )}
        {outcome?.kind === 'error' && (
          <Alert variant="warning" className="small py-2">
            {text.aiFailed}
          </Alert>
        )}
        {outcome?.kind === 'busy' && (
          <Alert variant="info" className="small py-2">
            {text.busy}
          </Alert>
        )}
        {done && (
          <>
            <Alert variant="success" className="small py-2">
              {outcome.reason || text.passTitle}
            </Alert>
            <MemoryButton questId={quest.id} className="mb-1" />
          </>
        )}
        {awaitingGps && (
          <Alert variant="info" className="small py-2">
            {text.passAwaitingGps}
          </Alert>
        )}

        {/* fallback: 사진만으로 확인이 어려우면 사용자를 막지 않는다 */}
        {showFallback && (
          <Alert variant="secondary" className="py-2">
            <div className="fw-bold">{text.fallbackTitle}</div>
            <div className="small mb-2">{text.fallbackBody}</div>
            <div className="d-flex gap-2">
              <Button size="sm" variant="outline-secondary" disabled={selfBusy} onClick={onClose}>
                {text.fallbackBack}
              </Button>
              <Button size="sm" disabled={selfBusy} onClick={confirmSelf}>
                {selfBusy ? UI_TEXT.quest.completing : text.fallbackConfirm}
              </Button>
            </div>
          </Alert>
        )}

        {canPick && !photo && <div className="small text-muted">{text.choose}</div>}
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        {canPick ? (
          <div className="d-flex flex-wrap gap-2">
            <Button size="sm" variant="outline-primary" onClick={() => cameraRef.current?.click()}>
              {text.pickCamera}
            </Button>
            <Button size="sm" variant="outline-primary" onClick={() => galleryRef.current?.click()}>
              {text.pickGallery}
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="d-flex gap-2">
          <Button size="sm" variant="outline-secondary" disabled={busy} onClick={onClose}>
            {text.close}
          </Button>
          {canPick && photo && (
            <Button size="sm" disabled={busy} onClick={submit}>
              {text.submit}
            </Button>
          )}
          {busy && (
            <span className="small text-muted align-self-center">
              <Spinner animation="border" size="sm" /> {text.verifying}
            </span>
          )}
        </div>
      </Modal.Footer>
    </Modal>
  )
}
