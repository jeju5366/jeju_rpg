import { evaluateGpsProof } from '../../../src/utils/gps.js'
import { HttpError } from '../http.js'
import { isPhotoQuest, photoAttemptState } from '../photo/mode.js'

// 퀘스트 인증 확인 지점. completeQuest 가 보상을 주기 전에 반드시 여기를 거친다. (사진 인증도 같은 완료 흐름을 재사용한다)
//
// quest.verification_type 은 "의도한 인증 방식"이고 DB 에 그대로 남는다. 실제로 어떤 방식으로 완료했는지는
// quest_progress.verification_method 에 기록한다. (EXP 배수/발견 EXP 는 이 "실제 완료 방식"으로 계산한다)
//
// 완료 방식(verification_method)
//   self       직접 확인.   verification_type 이 self/gps 이면 언제나 가능.
//                           사진이 들어가는 퀘스트(photo_*, gps_photo)는 사진 AI 인증을 다 써야(2회 판정 또는 2회 장애) 가능한 fallback.
//   gps        GPS 인증.    payload.method='gps' + position. 서버가 반경/정확도/시각을 검증한다.
//   photo_upload / photo_ai   사진 인증 성공(업로드만 확인 / AI 판정 pass). 사진 API(quests-photo-verify)가 서버 내부에서 지정한다.
//   gps_photo  GPS + 사진.  두 조건이 모두 충족돼야 최종 완료. 중간 상태는 quest_progress 의 gps_verified_at / photo_verified_at.
//
// 반환: { method }                       — 최종 완료로 인정된 방식
//       { pending: 'photo', gps }        — gps_photo 의 GPS 단계만 통과. 아직 완료가 아니다(EXP 없음). 사진 인증을 마저 해야 한다.
//       GPS/방식 조건을 못 채우면 HttpError.
export function resolveVerification(quest, payload = {}, progress = null) {
  if (payload.method !== 'gps') return resolveSelf(quest, progress)

  // GPS 인증은 GPS 를 의도한 퀘스트(gps / gps_photo)에서만, 장소 좌표가 있을 때만 쓸 수 있다.
  if (quest.verification_type !== 'gps' && quest.verification_type !== 'gps_photo') throw new HttpError(400, 'gps_not_supported')
  if (!Number.isFinite(quest.place_lat) || !Number.isFinite(quest.place_lng)) throw new HttpError(409, 'gps_target_unavailable')

  const result = evaluateGpsProof({ position: payload.position, target: { lat: quest.place_lat, lng: quest.place_lng } })
  if (!result.ok) {
    const status = result.code === 'gps_position_invalid' ? 400 : 422
    throw new HttpError(status, result.code, { distanceMeters: result.distanceMeters ?? null, accuracy: result.accuracy ?? null })
  }
  const gps = { distanceMeters: result.distanceMeters, accuracy: result.accuracy }

  if (quest.verification_type === 'gps') return { method: 'gps', gps }
  // gps_photo: 사진까지 끝나 있어야 최종 완료. 아니면 GPS 단계만 기록하고 미완료로 둔다.
  if (progress?.photo_verified_at) return { method: 'gps_photo', gps }
  return { pending: 'photo', gps }
}

function resolveSelf(quest, progress) {
  if (!isPhotoQuest(quest)) return { method: 'self' }
  const photo = photoAttemptState(progress)
  // 사진 인증을 다 썼으면 직접 확인 fallback. (사용자를 막지 않는다)
  if (photo.exhausted) return { method: 'self' }
  // gps_photo 에서 사진은 통과했는데 GPS 를 쓸 수 없는 경우(권한 거부 등)에도 갇히지 않게 직접 확인을 허용한다.
  if (quest.verification_type === 'gps_photo' && progress?.photo_verified_at) return { method: 'self' }
  throw new HttpError(409, 'photo_required', { attemptsLeft: photo.attemptsLeft })
}
