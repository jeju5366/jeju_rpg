import { Alert, Badge, Button, Card } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { calcQuestExp } from '../../utils/exp.js'
import { questGrowthPreview } from '../../utils/questLayout.js'
import { CategoryChips } from '../common/CategoryChip.jsx'
import { isPhotoQuest, photoAttemptState, photoModeOf, PHOTO_TYPES } from '../../utils/photoMode.js'
import MemoryButton from './MemoryButton.jsx'

// 퀘스트 1개. 핵심/선택 구분, 난이도, 카테고리(최대 2개), 인증 방식, 제한시간, 장소, 예상 EXP 를 보여준다.
// 인증 UI
//   · GPS 퀘스트(장소 좌표 있음): [위치로 인증] + fallback [직접 확인으로 완료]
//   · 사진 퀘스트: [사진으로 인증]. AI 확인을 다 쓰면(2회 판정/2회 장애) [직접 완료 확인] fallback 이 열린다.
//   · gps_photo: 위치 + 사진 두 단계가 모두 끝나야 완료. 단계별 진행 상태를 배지로 보여준다.
// props
//   progress    : quest_progress 행(없으면 null) — 사진 시도 횟수 / GPS·사진 중간 인증 상태
//   gpsFeedback : { kind, message } 방금 시도한 GPS 인증 결과 안내
//   memorySaved : 이 퀘스트의 사진이 추억으로 저장돼 있는지
export default function QuestCard({ quest, progress, completed, canComplete, busy, disabled, gpsBusy, gpsFeedback, memorySaved, onComplete, onGpsComplete, onPhoto, onCollapse, onViewMap = null }) {
  const text = UI_TEXT.quest
  const gpsText = UI_TEXT.gps
  const photoText = UI_TEXT.photo
  const isCore = quest.quest_type === 'core'
  const isGpsPhoto = quest.verification_type === 'gps_photo'
  const hasPhoto = isPhotoQuest(quest)
  const gpsIntended = quest.verification_type === 'gps' || isGpsPhoto
  const gpsReady = gpsIntended && quest.place_lat != null && quest.place_lng != null
  const photoMode = hasPhoto ? photoModeOf(quest) : null
  const photoState = photoAttemptState(progress)
  const gpsDone = Boolean(progress?.gps_verified_at)
  const photoDone = Boolean(progress?.photo_verified_at)
  const categories = [quest.category_primary, quest.category_secondary].filter(Boolean)
  const exp = (method) => calcQuestExp({ difficulty: quest.difficulty, questType: quest.quest_type, verificationMethod: method }).total
  const photoExpMethod = isGpsPhoto ? 'gps_photo' : photoMode === 'upload_only' ? 'photo_upload' : 'photo_ai'

  // 사진 퀘스트의 직접 확인(fallback)은 사진 AI 를 다 썼거나, gps_photo 에서 사진은 통과했는데 GPS 를 못 쓰는 경우에만 열린다. (서버도 같은 규칙으로 막는다)
  const selfOpen = hasPhoto && ((photoMode === 'ai_check' && photoState.exhausted) || (isGpsPhoto && photoDone))
  const off = !canComplete || disabled || gpsBusy || busy
  const completedByPhoto = completed && PHOTO_TYPES.includes(progress?.verification_method)

  return (
    <Card className={`mb-2 ${completed ? 'border-success' : ''}`}>
      <Card.Body className="py-2">
        {/* 펼친 compact 카드를 다시 접는 버튼 (선택 퀘스트 / 다시 본 완료 퀘스트) */}
        {onCollapse && (
          <div className="text-end">
            <button type="button" className="quest-collapse" aria-expanded="true" onClick={onCollapse}>
              {UI_TEXT.questLayout.collapse} <span aria-hidden="true">▴</span>
            </button>
          </div>
        )}
        <div className="d-flex flex-wrap gap-1 mb-1">
          <Badge bg={isCore ? 'primary' : 'secondary'}>{isCore ? text.core : text.optional}</Badge>
          <Badge bg="light" text="dark">
            {text.difficulty[quest.difficulty]}
          </Badge>
          {categories.map((category) => (
            <Badge key={category} bg="success">
              {UI_TEXT.categories[category] ?? category}
            </Badge>
          ))}
          <Badge bg="info" text="dark">
            {text.verification[quest.verification_type]}
          </Badge>
          {quest.time_limit_minutes && (
            <Badge bg="warning" text="dark">
              {text.timeLimit} {quest.time_limit_minutes}
              {text.minutes}
            </Badge>
          )}
        </div>
        <div className="fw-bold">{quest.title}</div>
        <div className="small text-muted">{quest.description}</div>
        {quest.place_name && <div className="small">📍 {quest.place_name}</div>}
        {onViewMap && (
          <Button variant="link" size="sm" className="p-0 mb-1" onClick={onViewMap}>
            {UI_TEXT.questMap.viewOnMap}
          </Button>
        )}
        {!completed && (
          <div className="quest-growth">
            <span className="quest-growth__label">{UI_TEXT.questLayout.growthPreview}</span> <CategoryChips parts={questGrowthPreview(quest)} />
          </div>
        )}

        {/* gps_photo: 두 단계 진행 상태 */}
        {isGpsPhoto && !completed && (
          <div className="d-flex gap-1 mt-1">
            <Badge bg={gpsDone ? 'success' : 'secondary'}>
              📍 {photoText.gpsStep} {gpsDone ? photoText.stepDone : photoText.stepWait}
            </Badge>
            <Badge bg={photoDone ? 'success' : 'secondary'}>
              📷 {photoText.photoStep} {photoDone ? photoText.stepDone : photoText.stepWait}
            </Badge>
          </div>
        )}

        {gpsFeedback && (
          <Alert variant={gpsFeedback.kind === 'accuracy_low' ? 'warning' : 'danger'} className="small py-1 px-2 mt-2 mb-0">
            {gpsFeedback.message}
          </Alert>
        )}

        <div className="mt-2 d-flex flex-wrap align-items-center gap-2">
          {completed ? (
            <>
              <Badge bg="success">✔ {text.done}</Badge>
              {completedByPhoto && <MemoryButton questId={quest.id} saved={memorySaved} />}
            </>
          ) : hasPhoto ? (
            <>
              {isGpsPhoto && gpsReady && !gpsDone && (
                <Button size="sm" disabled={off} onClick={onGpsComplete}>
                  {gpsBusy ? gpsText.verifying : gpsFeedback ? gpsText.retry : gpsText.verify}
                </Button>
              )}
              {!photoDone && (photoMode === 'upload_only' || !photoState.exhausted) && (
                <Button size="sm" variant={isGpsPhoto && gpsReady && !gpsDone ? 'outline-primary' : 'primary'} disabled={off} onClick={onPhoto}>
                  {photoState.attemptsUsed > 0 ? photoText.retry : photoText.verify}
                </Button>
              )}
              <span className="small text-muted">
                +{exp(photoExpMethod)} {UI_TEXT.progression.expPreview}
              </span>
              {selfOpen && (
                <>
                  <Button size="sm" variant="outline-secondary" disabled={off} onClick={onComplete}>
                    {busy ? text.completing : photoText.byHand}
                  </Button>
                  <span className="small text-muted">+{exp('self')}</span>
                </>
              )}
              <div className="w-100 small text-muted">
                {selfOpen
                  ? photoText.exhaustedHint
                  : isGpsPhoto && gpsDone && !photoDone
                    ? photoText.awaitingPhoto
                    : isGpsPhoto && photoDone && !gpsDone
                      ? photoText.awaitingGps
                      : photoMode === 'upload_only'
                        ? photoText.hintUpload
                        : photoText.hintAi}
              </div>
            </>
          ) : gpsReady ? (
            <>
              <Button size="sm" disabled={off} onClick={onGpsComplete}>
                {gpsBusy ? gpsText.verifying : gpsFeedback ? gpsText.retry : gpsText.verify}
              </Button>
              <span className="small text-muted">
                +{exp('gps')} {UI_TEXT.progression.expPreview}
              </span>
              <Button size="sm" variant="outline-secondary" disabled={off} onClick={onComplete}>
                {busy ? text.completing : gpsText.byHand}
              </Button>
              <span className="small text-muted">+{exp('self')}</span>
              <div className="w-100 small text-muted">{gpsFeedback ? gpsText.fallbackHint : gpsText.hint}</div>
            </>
          ) : (
            <>
              <Button size="sm" disabled={off} onClick={onComplete}>
                {busy ? text.completing : gpsIntended ? text.completeByHand : text.complete}
              </Button>
              <span className="small text-muted">
                +{exp('self')} {UI_TEXT.progression.expPreview}
              </span>
              {gpsIntended && <div className="w-100 small text-muted">{gpsText.unavailableTarget}</div>}
            </>
          )}
        </div>
      </Card.Body>
    </Card>
  )
}
