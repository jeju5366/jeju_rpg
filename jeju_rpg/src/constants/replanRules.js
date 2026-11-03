// 11단계 규칙 상수: REPLAN / 일정 지연·앞당김 / 날씨 변화 / 돌발 퀘스트 / 캐시. 서버(api/)와 화면이 같이 쓴다. 숫자는 여기서만 바꾼다.

// ───────── REPLAN reason ─────────
// SCHEDULE_AHEAD 는 REPLAN 사유로 쓰지 않는다. 일정이 빨라진 경우는 Bonus Opportunity(추가 콘텐츠 제안)로만 처리한다.
export const REPLAN_REASONS_ENABLED = ['RETURN_FROM_FREE_TRAVEL', 'WEATHER_CHANGE', 'SCHEDULE_DELAY', 'PLACE_UNAVAILABLE', 'USER_REQUEST', 'ACCOMMODATION_RISK']
// 시스템이 감지해서 "제안"하는 reason / 사용자가 직접 누르는 reason
export const REPLAN_SYSTEM_REASONS = ['RETURN_FROM_FREE_TRAVEL', 'WEATHER_CHANGE', 'SCHEDULE_DELAY', 'PLACE_UNAVAILABLE', 'ACCOMMODATION_RISK']
// 긴급 예외(하루 한도 3회를 넘겨도 hard max 까지 한 번 더 허용)
export const REPLAN_URGENT_REASONS = ['PLACE_UNAVAILABLE', 'ACCOMMODATION_RISK']

// 하루 REPLAN "실행" 한도 (실행은 항상 사용자 승인 후)
export const REPLAN_DAILY_LIMITS = {
  systemSuggestionsPerDay: 2, // 시스템이 같은 날 사용자에게 제안할 수 있는 횟수 (화면 쪽 제한)
  systemExecutionsPerDay: 2, // 시스템 제안을 승인해서 실행한 횟수
  manualExecutionsPerDay: 1, // 사용자가 직접 "일정 다시 맞추기"를 눌러 실행한 횟수
  normalTotalPerDay: 3, // 일반 합계
  hardMaxPerDay: 4, // 긴급 예외 포함 절대 한도
  systemCooldownMinutes: 30,
  manualCooldownMinutes: 15,
  // 사용자가 "기존 일정 계속"을 누른 같은 reason 은 이 시간 동안 다시 제안하지 않는다
  dismissMinutes: 45,
}

// ───────── 일정 지연 / 앞당김 ─────────
// 챕터마다 "예상 소요 시간"(활동 + 이동)과 실제 소요 시간을 비교한다. 챕터가 열린 시각(activated_at)과 닫힌 시각(closed_at)이 기준이다.
export const SCHEDULE_RULES = {
  expectedChapterMinutes: 60, // 챕터 하나의 활동 시간 기본 가정 (이동시간은 따로 더한다)
  defaultTravelMinutes: 20, // 이동시간을 모를 때의 기본 가정
  ignoreBelowMinutes: 15, // 10~15분 지연은 무시
  checkFromMinutes: 20, // 20~30분: 내부적으로만 상황 확인 (사용자에게 제안하지 않는다)
  suggestFromMinutes: 30, // 30분 이상: REPLAN 제안 가능 (남은 일정/종료 시간과 함께 판단)
  strongFromMinutes: 60, // 60분 이상: 강한 재조정 제안
  aheadFromMinutes: 30, // 30분 이상 빠르면 Bonus Opportunity (REPLAN 아님)
  endBufferMinutes: 20, // 종료 희망 시간보다 이만큼 일찍 마무리돼야 한다
  perChapterMinutes: 50, // 남은 챕터 하나에 필요한 시간 추정 (이동 제외)
}

// ACCOMMODATION_RISK: 남은 일정을 그대로 하면 숙소 도착이 종료 희망 시간보다 이만큼 이상 늦어질 때
export const ACCOMMODATION_RISK_LATE_MINUTES = 30

// ───────── 날씨 변화 (큰 변화만 REPLAN 후보) ─────────
export const WEATHER_CACHE_MINUTES = 25 // 20~30분 캐시. 만료된 뒤 챕터 전환/앱 복귀/자유여행 복귀/사용자 확인 때만 다시 가져온다
export const WEATHER_RULES = {
  strongWindMs: 14, // 야외 활동이 어려운 강풍
  heatC: 34, // 폭염 수준
  coldFeelsLikeC: -3, // 강한 추위(체감) — 바람과 함께
  coldWindMs: 8,
  heavyRainMmPerHour: 10, // 강한 비
  rainProbability: 70, // 앞으로 6시간 안의 높은 강수 확률
  minTempChangeC: 8, // 단순 온도 변화는 이 값 미만이면 무시
}
export const RAIN_TYPES = ['rain', 'rain_snow', 'snow', 'shower', 'drizzle', 'drizzle_snow', 'snow_flurry']
// 실내로 볼 수 있는 TourAPI contentTypeId (코드가 필터한다. GPT 가 실내 여부를 지어내지 않는다): 14 문화시설, 38 쇼핑, 39 음식점
export const INDOOR_CONTENT_TYPES = [14, 38, 39]
export const OUTDOOR_CONTENT_TYPES = [12, 28] // 12 관광지(대부분 야외), 28 레포츠

// ───────── 이동시간 (NAVER Directions) ─────────
export const TRAVEL_RULES = {
  maxDirectionsPerRequest: 6, // 한 번의 REPLAN/예고 계산에서 Directions 를 부르는 최대 횟수 (후보 전부를 부르지 않는다)
  cacheMinutes: 30,
  transitKmh: 20, // 대중교통 보수적 추정(직선거리 × 1.4 / 속도 + 대기)
  transitWaitMinutes: 12,
  walkKmh: 4.2,
  carKmh: 35, // Directions 가 없을 때의 자동차 추정
  roadFactor: 1.3, // 직선거리 → 도로거리 보정
}

// ───────── 돌발 퀘스트 (Surprise) ─────────
export const SURPRISE_RULES = {
  maxPerDay: 3, // MAX_SURPRISE_QUESTS_PER_DAY
  cooldownMinutes: 60,
  maxDistanceMeters: 800, // 현재 anchor 중심 도보권 (직선거리)
  dwellMinutes: 3, // anchor 근처 체류로 "안정적인 시점" 판단
  anchorRadiusMeters: 200,
  movingSpeedMs: 3, // GPS speed 가 이 값 이상이면 이동 중으로 본다 (speed 가 없으면 무시 — 항상 신뢰하지 않는다)
  minRemainingMinutes: 40, // 종료 희망 시간까지 이만큼은 남아 있어야 한다
  nearbyLimit: 12,
}
export const SURPRISE_TRIGGERS = ['core_completed', 'chapter_completed', 'anchor_dwell', 'ahead_of_schedule', 'free_travel_dwell']

// ───────── 화면 캐시 (탭 전환) ─────────
export const CACHE_RULES = {
  boardStaleMs: 60 * 1000, // 퀘스트 판은 이 시간이 지나야 백그라운드로 다시 읽는다 (mutation 이 있으면 즉시 갱신)
  hubStaleMs: 60 * 1000,
  visitedStaleMs: 5 * 60 * 1000,
  locationStaleMs: 2 * 60 * 1000, // 마지막 위치가 이보다 오래되면 (권한이 이미 허용된 경우에만) 조용히 새로 받는다
  travelPreviewStaleMs: 30 * 60 * 1000,
}
