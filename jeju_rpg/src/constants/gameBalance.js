// 밸런스/규칙 상수. 서버(api/)와 화면이 같이 쓴다.

// 여행 범위(travel_range)별 후보 장소 검색 반경(미터). TourAPI 상한은 20km.
export const TRAVEL_RANGES = ['near', 'normal', 'anywhere']
export const TRAVEL_RANGE_RADIUS_M = { near: 8000, normal: 15000, anywhere: 20000 }

// 모험 생성 규칙
export const ADVENTURE_RULES = {
  count: 3, // 한 번에 정확히 3개
  maxGenerationSets: 2, // 최초 1세트 + 재생성 1세트 (하루 최대 6개 후보)
  placesPerAdventure: { min: 3, max: 6 },
  maxAreas: 2, // 주요 권역 1개 + 인접 권역 최대 1개
  maxCategories: 3, // 모험의 대표 성향 최대 개수 (챕터 안 카테고리 제한은 QUEST_RULES)
  maxPlaceOverlap: 0.5, // 모험끼리 장소가 겹치는 비율 상한
  candidateCount: 15, // 서버가 GPT 에 넘기는 후보 장소 수 상한 (10~15개)
}

// 퀘스트 생성 규칙 (GENERATE_QUESTS)
export const QUEST_RULES = {
  chapters: { min: 2, max: 4 }, // 메인 퀘스트 1개 + 챕터 2~4개
  optionalPoolPerChapter: { min: 4, max: 5 }, // 챕터당 선택 퀘스트 pool
  initialVisibleOptional: 3, // 초기 공개 개수(2~3). 나머지는 is_hidden 으로 두고 "퀘스트 더 받기"에서 AI 재호출 없이 공개
  revealCount: 2, // "퀘스트 더 받기" 한 번에 공개하는 개수
  // 챕터 = 핵심 장소(anchor place) 하나, 또는 그 장소에서 도보로 가까운 주변에서 경험을 넓히는 단위.
  // 선택 퀘스트는 같은 장소(anchor)에서 하는 행동형을 우선하고, 다른 장소를 쓰는 건 0~3곳(도보 범위 안)으로 제한한다.
  optionalPlacesPerChapter: { min: 0, max: 3 },
  maxCategoriesPerQuest: 2, // 퀘스트 하나당 카테고리 최대 2개 (primary + secondary). 챕터 전체 제한은 없다.
  // anchor 도보 범위. 지금은 NAVER 도보 시간이 없어 직선거리(미터)로 대신한다. (기본 500~800m)
  // TODO(9단계): 실제 도보 시간 기준 walkMaxMinutes(5~10분)로 교체 — api/_lib/agent/walkability.js 의 walkAccess 만 바꾸면 된다.
  walkPreferredMeters: 500,
  walkMaxMeters: 800,
  walkMaxMinutes: 10,
  timeLimitMinutes: { min: 10, max: 60 },
  extraPlaceCount: 12, // 각 anchor 의 도보 범위 안에서 선택 장소용으로 더 가져오는 주변 후보 수(전체 상한)
}
export const DIFFICULTIES = ['easy', 'normal', 'hard']
export const VERIFICATION_TYPES = ['self', 'gps', 'photo_upload', 'photo_ai', 'gps_photo']

// ───────── EXP (8단계) ─────────
// 퀘스트 EXP = round(기본 EXP × 퀘스트 유형 배수 × 인증 방식 배수) + 제한시간 성공 보너스
export const EXP_BASE = { easy: 10, normal: 20, hard: 30 }
export const QUEST_TYPE_MULTIPLIER = { core: 1.5, optional: 1.0, surprise: 1.5 } // main 은 EXP 없음 (모험 완주 자유 EXP 로 대신)
// 실제로 완료한 방식 기준. 지금은 self 만 구현되어 있고 gps / photo 는 9~10단계에서 같은 계산을 쓴다.
export const VERIFICATION_MULTIPLIER = { self: 0.9, gps: 1.0, photo_upload: 1.05, photo_ai: 1.05, gps_photo: 1.1 }
export const TIME_LIMIT_BONUS = 5 // 제한시간 성공 시 (현재는 타이머가 없어 적용되지 않음)

// 자유 EXP: 특정 카테고리에 자동으로 들어가지 않고 unspent_exp 에 쌓인다.
export const FREE_EXP = { chapterComplete: 20, adventureComplete: 50, finalComplete: 100 }
// 자유 EXP 투자 가능 카테고리. 지금은 일반 5개만 허용한다. (discovery 투자를 열려면 'discovery' 를 추가하고 006 SQL 의 jeju_invest_exp 도 같이 수정)
export const FREE_EXP_INVEST_CATEGORIES = ['explore', 'culture', 'food', 'relax', 'social']
// 챕터를 하나라도 건너뛴 모험에는 "모험 완주" 자유 EXP 를 주지 않는다. (false 로 바꾸면 건너뛰어도 완주 보너스를 준다)
export const ADVENTURE_BONUS_REQUIRES_NO_SKIPPED_CHAPTER = true

// 발견 EXP: 평생 최초 방문에만. 명소 여부는 DB whitelist(jeju_landmarks)로만 정한다.
export const DISCOVERY_EXP = { normal: 20, landmark: 35 }
// 발견을 인정하는 완료 방식: "그 장소에 실제로 있었다"는 위치 근거(GPS)가 있는 방식만. (9단계에서 self 를 뺐고, 10단계에서 사진 단독도 뺐다)
//  - self(직접 확인) / photo_upload / photo_ai(사진만): 퀘스트 EXP 와 방문 기록은 받지만 발견 EXP 는 주지 않는다.
//    사진은 현장이 아니어도 구할 수 있고 EXIF 위치정보에는 의존하지 않기 때문이다.
//  - gps / gps_photo: GPS 근거가 있으므로 발견 EXP 가능. 자유여행 방문은 이 목록이 아니라 위치 근거(evidence)로 판단한다.
//  - 사진 단독도 발견을 주고 싶으면 'photo_upload', 'photo_ai' 를 다시 넣으면 된다.
export const DISCOVERY_ALLOWED_METHODS = ['gps', 'gps_photo']

// 경험도 단계: 카테고리 레벨은 "얼마나 경험했는가"이고 추천 선호도가 아니다. (선호도 = travel_preferences)
// Agent 에는 레벨과 단계만 전달해서 입문/심화 조절, 표현의 깊이, 반복 감소, 새로운 형태 제안에만 쓰게 한다.
export const EXPERIENCE_TIER_LEVELS = { intermediate: 10, advanced: 40 } // 이 레벨 이상이면 해당 단계

// 성향/EXP 카테고리 6축 (성향 테스트, 모험의 대표 성향, EXP 컬럼)
export const CATEGORIES = ['explore', 'culture', 'food', 'relax', 'social', 'discovery']

// 일반 퀘스트의 EXP 카테고리는 5개뿐이다.
// discovery EXP 는 jeju_place_discoveries(평생 최초 방문)로만 지급하고, 퀘스트 완료 보상으로는 주지 않는다. (8단계)
export const QUEST_CATEGORIES = ['explore', 'culture', 'food', 'relax', 'social']
