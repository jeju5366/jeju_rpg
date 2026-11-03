// GPS / 자유여행 규칙 상수 (9단계). 서버(api/)와 화면이 같이 쓴다. 숫자는 여기서만 바꾸면 된다.

// ───────── GPS 퀘스트 인증 ─────────
export const GPS_QUEST_RADIUS_METERS = 150 // 목표 장소 반경 안이면 인증 성공
export const GPS_MAX_ACCURACY_METERS = 100 // 이보다 부정확하면 실패가 아니라 "다시 확인" (재시도 가능)
export const GPS_MAX_AGE_MS = 2 * 60 * 1000 // 이보다 오래된 위치는 쓰지 않는다 (서버가 확인)
export const GPS_FUTURE_TOLERANCE_MS = 60 * 1000 // 기기 시계가 서버보다 약간 앞서 있어도 허용
// 위치 한 번 받을 때: 정확도가 이 값 이하가 될 때까지 최대 timeout 동안 기다렸다가 가장 좋은 값을 쓴다.
export const GPS_SAMPLE = { goodAccuracyMeters: 40, timeoutMs: 12000, maxAgeMs: 10000 }

// ───────── 자유여행: 이동 경로 기록 (프론트 세션에만 둔다) ─────────
// 위치 갱신이 들어와도 아래 거리/시간 중 하나를 넘을 때만 경로 포인트를 더한다. (매초 기록 X, DB 저장 X)
export const ROUTE_MIN_DISTANCE_METERS = 60
export const ROUTE_MIN_INTERVAL_MS = 60 * 1000
export const ROUTE_MAX_POINTS = 600 // 넘으면 오래된 쪽부터 절반으로 솎는다
export const TRACK_MAX_ACCURACY_METERS = 150 // 이보다 부정확한 위치는 경로/체류 판정에 쓰지 않는다
// 이 시간 넘게 위치 갱신이 끊기면(탭이 멈춤 등) 그 사이는 "머문 것"으로 이어 붙이지 않는다.
export const TRACK_MAX_GAP_MS = 10 * 60 * 1000

// ───────── 자유여행: 방문 후보 감지 ─────────
export const FREE_VISIT_RADIUS_METERS = 200
export const FREE_VISIT_DWELL_MINUTES = 5
// 반경을 벗어나도 이 배수 안쪽이면 아직 머무는 중으로 본다. (GPS 흔들림으로 체류 시간이 리셋되는 것 방지)
export const FREE_VISIT_EXIT_RADIUS_FACTOR = 1.25
// 서버가 경로로 체류를 다시 확인할 때 경로 간격 때문에 생기는 오차 허용(분)
export const FREE_VISIT_DWELL_TOLERANCE_MINUTES = 1
// "의미 있는 장소"만 후보로 본다: 12 관광지 / 14 문화시설 / 28 레포츠 / 38 쇼핑 / 39 음식점
export const FREE_VISIT_CONTENT_TYPES = [12, 14, 28, 38, 39]

// ───────── 자유여행: 주변 장소 조회 (API 남발 방지) ─────────
// 아래 조건 중 하나일 때만 TourAPI 를 다시 부른다. GPS 위치 갱신마다 부르지 않는다.
export const NEARBY_FETCH_RADIUS_METERS = 2500
export const NEARBY_FETCH_LIMIT = 60
export const NEARBY_REFETCH_DISTANCE_METERS = 1200 // 마지막 조회 지점에서 이만큼 이동
export const NEARBY_REFETCH_TTL_MS = 15 * 60 * 1000 // 캐시 만료
export const NEARBY_MIN_INTERVAL_MS = 2 * 60 * 1000 // 어떤 경우에도 이 간격 안에는 다시 부르지 않는다
export const NEARBY_FAILURE_COOLDOWN_MS = 5 * 60 * 1000 // 실패하면 이만큼 쉰다

// ───────── 자유여행: 수동 방문 기록 ─────────
// 현재 위치 하나가 아니라 "자유여행 동안의 이동 경로" 전체에서 가장 가까운 점까지의 거리로 판단한다.
export const MANUAL_VISIT_ROUTE_MAX_DISTANCE_METERS = 3000
// 경로 포인트가 이 개수 미만이면 "신뢰할 GPS 근거 없음": 방문은 저장하되 발견 EXP 는 주지 않는다.
export const MANUAL_VISIT_MIN_ROUTE_POINTS = 3
export const MANUAL_VISIT_SEARCH_RADIUS_METERS = 3000 // 수동 추가 후보를 경로 주변에서 찾는 반경
export const FREE_VISIT_MAX_PER_SAVE = 30 // 한 번에 저장할 수 있는 방문 수

// ───────── 자유여행 종료 후 모험 복귀 판정 (코드가 판단, GPT 호출 없음) ─────────
export const RETURN_RULES = {
  farFromNextPlaceMeters: 12000, // 이어갈 다음 장소에서 이만큼 멀어지면 어색하다고 본다
  longFreeTravelMinutes: 150, // 자유여행이 이만큼 길어졌다
  perChapterMinutes: 50, // 남은 챕터 하나에 필요한 시간 (직선거리/이동 포함 아님)
  driveSpeedKmh: 35, // 직선거리 기반 이동시간 추정 (Directions 호출 없이)
  endBufferMinutes: 20, // 종료 희망 시간보다 이만큼 일찍 마무리돼야 한다
  accommodationFarMeters: 20000, // 숙소에서 이만큼 멀고
  accommodationCheckWithinMinutes: 180, // 종료 희망 시간까지 이 시간 안쪽이면 귀환 동선이 바뀐 것으로 본다
}
