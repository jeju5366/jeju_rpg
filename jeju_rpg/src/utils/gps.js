import {
  GPS_FUTURE_TOLERANCE_MS,
  GPS_MAX_ACCURACY_METERS,
  GPS_MAX_AGE_MS,
  GPS_QUEST_RADIUS_METERS,
} from '../constants/locationRules.js'
import { haversineMeters, isLatLng } from './geo.js'

// GPS 퀘스트 인증 판정. 서버(quests-complete)가 이 함수로 최종 판단하고, 화면은 같은 함수로 미리 안내만 한다.
// position: { lat, lng, accuracy, timestamp(ms) } / target: { lat, lng }
// → { ok: true, distanceMeters, accuracy } | { ok: false, code, distanceMeters?, accuracy? }
//   code: gps_position_invalid | gps_position_stale | gps_accuracy_low(재시도 가능) | gps_too_far
export function evaluateGpsProof({ position, target, now = Date.now(), radius = GPS_QUEST_RADIUS_METERS }) {
  if (!isLatLng(position) || !isLatLng(target)) return { ok: false, code: 'gps_position_invalid' }
  const accuracy = Number(position.accuracy)
  const timestamp = Number(position.timestamp)
  if (!Number.isFinite(accuracy) || accuracy < 0 || !Number.isFinite(timestamp)) return { ok: false, code: 'gps_position_invalid' }

  const age = now - timestamp
  if (age > GPS_MAX_AGE_MS || age < -GPS_FUTURE_TOLERANCE_MS) return { ok: false, code: 'gps_position_stale', accuracy }

  const distanceMeters = haversineMeters(position, target)
  // 정확도가 낮으면 거리 판정이 무의미하다. 실패로 끝내지 않고 다시 확인하게 한다.
  if (accuracy > GPS_MAX_ACCURACY_METERS) return { ok: false, code: 'gps_accuracy_low', distanceMeters, accuracy }
  if (distanceMeters > radius) return { ok: false, code: 'gps_too_far', distanceMeters, accuracy }
  return { ok: true, distanceMeters, accuracy }
}
