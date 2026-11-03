// 12단계 Final Quest 규칙 상수. 서버(api/)와 화면이 같이 쓴다. 숫자는 여기서만 바꾼다.
// 안전 시간은 항상 "코드"가 계산한다. GPT/Agent 는 항공편/이동시간/혼잡도를 추측하거나 안전 시간을 늦출 수 없다.

// 공항 도착 목표: 출발 시각보다 이만큼 일찍 공항에 도착해야 한다.
export const AIRPORT_ARRIVE_BEFORE_MIN = { domestic: 90, international: 150 }

// 혼잡도 보정. 공항 혼잡도 API 의 종합 단계(1 원활 / 2 보통 / 3 혼잡 / 4 매우혼잡)를 분으로 바꾼다.
// 조회 실패/없음 → DEFAULT_CONGESTION_BUFFER_MIN (보정 없음)
export const CONGESTION_BUFFER_MIN = { 1: 0, 2: 0, 3: 30, 4: 60 }
export const DEFAULT_CONGESTION_BUFFER_MIN = 0

// 현재 위치 → 제주공항 이동시간을 계산할 수 없을 때(위치/좌표 없음)의 보수적 기본값. 모르면 넉넉하게 잡는다.
export const FALLBACK_TRAVEL_TO_AIRPORT_MIN = 60

// 사전 안내: latestSafeDeparture 이 시간 전부터 "공항 이동 준비" 안내 + 새 돌발/긴 선택 퀘스트 생성 중단
export const NOTICE_BEFORE_MIN = 60

// 공항 GPS 도착 반경 (퀘스트 GPS 반경 150m 와 별개). 기본 self 대체 없음 — 사용자가 공항에 실제로 있어야 한다.
export const AIRPORT_ARRIVAL_RADIUS_M = 500

// 마지막 날 모험: 마지막 챕터 핵심 장소 → 공항 이동시간은 이 값 이하가 "강한 선호"다. (절대 규칙 아님: 후보가 없으면 일정을 줄인다)
export const LAST_DAY_AIRPORT_MAX_MIN = 60
// 마지막 날: 공항 반대 방향으로 깊게 들어가는 후보 패널티 (공항에서 이 거리(m)를 넘으면 점수 감점)
export const LAST_DAY_FAR_METERS = 40000

// Final Quest 진행 중 추가 경유 허용 여부. 지금은 항상 false (공항 이동만). 추후 "공항 근처 기념품 가게" 같은 경유를 허용할 때 true.
export const ALLOW_FINAL_QUEST_EXTRAS = false

// 현재 위치로 쓸 수 있는 최대 나이. 기존 위치 캐시 정책(CACHE_RULES.locationStaleMs = 2분)에 위치 전달 지연 여유 1분을 더했다.
// 이보다 오래된 위치는 "현재 위치"처럼 쓰지 않고 현재 챕터 핵심 장소 → 60분 기본값 순서로 대체한다.
export const FINAL_QUEST_POSITION_MAX_AGE_MS = 3 * 60 * 1000

// 외부 API 캐시(TTL). 화면 렌더마다 호출하지 않고, 마지막 날에만 필요할 때 조회한다.
export const FINAL_QUEST_CACHE = {
  evalStaleMs: 5 * 60 * 1000, // 클라이언트: 같은 평가 결과를 이 시간 동안 재사용
  flightTtlMs: 10 * 60 * 1000, // 서버: 항공편 조회 결과
  congestionTtlMs: 10 * 60 * 1000, // 서버: 혼잡도 조회 결과
}

// 국내선 도착 공항 IATA (제주 출발 기준). 이 목록에 없는 도착 공항이면 국제선으로 본다. 도착 공항을 모르면 국내선으로 본다.
export const DOMESTIC_AIRPORT_CODES = ['GMP', 'ICN', 'PUS', 'TAE', 'CJJ', 'KWJ', 'RSU', 'USN', 'KUV', 'MWX', 'HIN', 'WJU', 'KPO', 'YNY', 'CJU']

// 항공편 상태 (code 가 판단한다)
export const FLIGHT_STATES = ['normal', 'delayed', 'cancelled', 'unknown']

// 임시 칭호 (이름/연출은 14단계에서 확정). 조건은 여기서만 바꾼다.
export const TEMP_TITLES = {
  first: { code: 'trip_first_complete', name: '제주 첫 모험 완료' },
  explorer: { code: 'trip_explorer', name: '탐험형 여행자', category: 'explore', minCategoryQuests: 3 },
  foodie: { code: 'trip_foodie', name: '미식 여행자', category: 'food', minCategoryQuests: 3 },
  discoverer: { code: 'trip_discoverer', name: '발견가', minDiscoveries: 3 },
  master: { code: 'trip_quest_master', name: '퀘스트 완주자', minCompleted: 10 },
}
