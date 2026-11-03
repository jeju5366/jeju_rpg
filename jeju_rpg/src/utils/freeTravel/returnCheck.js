import { RETURN_RULES } from '../../constants/locationRules.js'
import { haversineMeters, isLatLng } from '../geo.js'

// 자유여행 종료 후 "기존 모험으로 그대로 돌아가도 되는지"를 코드가 판단한다. (GPT 호출 없음)
// needsReplan 이 true 일 때만 화면이 "일정 다시 맞추기"를 제안하고, 사용자가 누를 때만 REPLAN 을 요청한다.

const toMinutes = (hhmm) => {
  if (!hhmm) return null
  const [h, m] = String(hhmm).split(':')
  return Number.isFinite(Number(h)) ? Number(h) * 60 + Number(m || 0) : null
}
const kstMinutesOfDay = (ms) => {
  const kst = new Date(ms + 9 * 3600 * 1000)
  return kst.getUTCHours() * 60 + kst.getUTCMinutes()
}

// 아직 닫히지 않은 챕터에서 "남은 일정"을 뽑는다. (닫힌 챕터/완료한 퀘스트는 건드리지 않는다)
// → { remainingChapters, stops: [{ placeId, name, lat, lng }] }  stops 는 핵심 장소 순서
export function collectRemainingPlan({ chapters = [], quests = [] }) {
  const open = chapters
    .filter((c) => ['active', 'core_completed', 'locked', 'available'].includes(c.status))
    .sort((a, b) => a.seq - b.seq)
  const stops = []
  for (const chapter of open) {
    if (chapter.status === 'core_completed') continue // 핵심 장소는 이미 다녀왔다
    const core = quests.find((q) => q.chapter_id === chapter.id && q.quest_type === 'core')
    if (!core?.place_id) continue
    stops.push({ placeId: core.place_id, name: core.place_name, lat: core.place_lat ?? null, lng: core.place_lng ?? null })
  }
  return { remainingChapters: open.length, stops }
}

// input: { now(ms), position, desiredEndTime, accommodation, remainingChapters, stops, visitedPlaceIds, freeStartedAt(ms) }
// → { needsReplan, reasons: string[], metrics }
//   reasons: far_from_plan | long_free_travel | planned_place_visited | end_time_conflict | accommodation_route_changed
// weatherMajor: 날씨가 크게 바뀌었는지(코드 판단, schedule.assessWeatherChange). 큰 변화가 아니면 날씨 때문에 바꾸지 않는다.
export function evaluateReturn({ now, position, desiredEndTime, accommodation, remainingChapters, stops = [], visitedPlaceIds = [], freeStartedAt, weatherMajor = false }) {
  const rules = RETURN_RULES
  const reasons = []
  const metrics = {}
  if (!remainingChapters) return { needsReplan: false, reasons, metrics } // 남은 일정이 없으면 조정할 것도 없다

  const visited = new Set(visitedPlaceIds)
  const nextStop = stops.find((s) => isLatLng(s))
  const hasPosition = isLatLng(position)

  // 1) 이어갈 다음 장소에서 크게 멀어짐
  if (hasPosition && nextStop) {
    metrics.distanceToNextMeters = haversineMeters(position, nextStop)
    if (metrics.distanceToNextMeters > rules.farFromNextPlaceMeters) reasons.push('far_from_plan')
  }

  // 2) 자유여행이 너무 길어짐
  if (Number.isFinite(freeStartedAt)) {
    metrics.freeMinutes = Math.round((now - freeStartedAt) / 60000)
    if (metrics.freeMinutes > rules.longFreeTravelMinutes) reasons.push('long_free_travel')
  }

  // 3) 예정된 핵심 장소를 자유여행 중 먼저 방문함
  const alreadyVisited = stops.filter((s) => visited.has(s.placeId))
  if (alreadyVisited.length) {
    metrics.visitedPlannedPlaces = alreadyVisited.map((s) => s.name ?? s.placeId)
    reasons.push('planned_place_visited')
  }

  // 4) 오늘 종료 희망 시간에 남은 일정이 맞지 않음 (직선거리 기반 추정. 정확한 이동시간은 REPLAN 단계에서 Directions 로 계산)
  const endMin = toMinutes(desiredEndTime)
  const nowMin = kstMinutesOfDay(now)
  if (endMin !== null) {
    const travelMin = metrics.distanceToNextMeters !== undefined ? (metrics.distanceToNextMeters / 1000 / rules.driveSpeedKmh) * 60 : 0
    const needMin = remainingChapters * rules.perChapterMinutes + travelMin
    const availableMin = endMin - nowMin - rules.endBufferMinutes
    metrics.needMinutes = Math.round(needMin)
    metrics.availableMinutes = Math.round(availableMin)
    if (needMin > availableMin) reasons.push('end_time_conflict')
  }

  // 5) 숙소에서 멀리 떨어져 있는데 종료 시간이 가까움 → 숙소 복귀 동선이 크게 바뀜
  if (hasPosition && isLatLng(accommodation) && endMin !== null) {
    metrics.distanceToAccommodationMeters = haversineMeters(position, accommodation)
    if (metrics.distanceToAccommodationMeters > rules.accommodationFarMeters && endMin - nowMin <= rules.accommodationCheckWithinMinutes) {
      reasons.push('accommodation_route_changed')
    }
  }

  // 6) 날씨가 크게 바뀜 (큰 변화일 때만)
  if (weatherMajor) reasons.push('weather_changed')

  // 자유여행이 길었다는 것만으로는 일정을 바꾸자고 하지 않는다. (기존 예정 다음 챕터가 여전히 수행 가능하면 가급적 유지)
  const meaningful = reasons.filter((r) => r !== 'long_free_travel')
  return { needsReplan: meaningful.length > 0, reasons: meaningful.length > 0 ? reasons : [], metrics }
}
