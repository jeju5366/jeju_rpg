# 외부 API 구조

## 원칙
- **사실 데이터는 외부 API/코드가 준비하고, GPT Agent 는 그 데이터를 바탕으로 모험/퀘스트만 설계한다.**
  GPT 가 거리, 시간, 날씨, 버스 도착, 항공편 상태, 영업, 방문, EXP 를 추측하게 만들지 않는다.
- 페이지/컴포넌트는 API 를 직접 호출하지 않고 `src/services/*` 를 통해서만 호출한다.
- 외부 API 인증키는 서버 함수(`api/*`)에만 두고 브라우저에 노출하지 않는다.
- 모든 `/api/*` 는 Supabase 로그인 토큰이 필요하다(없으면 401).
- 모든 응답은 `{ source: 'live' | 'mock', fetchedAt, data, fallback?, error? }` 형태다.
  Agent 에 사실 데이터를 넘길 때 `source` 도 함께 넘겨 mock/demo 여부를 추적한다. (6단계에서 연결)
- `DATA_MODE=live` 여도 API 별 키가 없거나 호출이 실패하면 그 API 만 mock 으로 대체하고 `fallback: true` 와 사유(`error`)를 표시한다.

## 호출 흐름
```
페이지 → src/services/<영역>/*Service.js → /api/<endpoint> → api/_lib/providers/*.js → (live) 외부 API / (mock) api/_lib/mock/*.js
```

## API ↔ services ↔ 엔드포인트

live 호출 방식은 `api_test` 프로젝트에서 동작을 확인한 코드를 이식했다. (키 없이 확인한 것은 "키 대기")

| 외부 API | services | 엔드포인트 | 역할 | 환경변수 |
|---|---|---|---|---|
| 한국관광공사 KorService2 (실패 시 KorService1) | `tour` | `/api/places` | 관광지/문화시설/음식점/행사 후보, 이미지, 위치 기반 주변 정보 (`contentTypeId` 12/14/15/39) | `TOUR_API_KEY` |
| 기상청 VilageFcstInfoService_2.0 | `weather` | `/api/weather` | 현재 날씨 + 시간대별 예보(기온/강수/하늘 상태/풍속). REPLAN 판단 재료 | `KMA_API_KEY` |
| TAGO BusSttnInfoInqireService | `transit` | `/api/transit-stops` | 주변 버스정류장 (`getCrdntPrxmtSttnList`) | `TAGO_API_KEY` |
| TAGO ArvlInfoInqireService | 〃 | `/api/transit-arrivals` | 정류장별 도착 예정 (`cityCode`, `nodeId` 필요) | 〃 |
| TAGO BusRouteInfoInqireService | 〃 | `/api/transit-routes` | 노선 기점/종점/유형 (`cityCode`, `routeId` 필요) | 〃 |
| 한국공항공사 flight-status | `airport` | `/api/airport-flights` | 제주 출발편 상태 (`flightNo` 필요, Final Quest) | `AIRPORT_API_KEY` |
| 한국공항공사 airport-congestion | 〃 | `/api/airport-congestion` | 제주공항 혼잡도 **단계**(1~4). 대기시간 필드는 없음 | 〃 |
| NAVER Directions 5 | `naver` | `/api/directions` | 자동차 이동시간/거리, 동선 계산 | `NAVER_MAP_CLIENT_ID`, `NAVER_MAP_CLIENT_SECRET` |
| NAVER Dynamic Map | `naver` | (브라우저 SDK) | 지도 표시, 현재 위치/장소 마커 (9단계, `api_test/src/components/NaverMap.jsx` 참고) | `VITE_NAVER_MAP_CLIENT_ID` |

## 환경변수 (`.env`)
| 이름 | 위치 | 설명 |
|---|---|---|
| `DATA_MODE` | 서버 | `live` 일 때만 실제 호출. 비우면 전부 mock |
| `TOUR_API_KEY`, `KMA_API_KEY`, `TAGO_API_KEY`, `AIRPORT_API_KEY` | 서버 | 공공데이터포털 API 별 인증키 (Encoding/Decoding 모두 가능) |
| `AIRPORT_FLIGHT_STATUS_URL`, `AIRPORT_CONGESTION_URL` | 서버 (선택) | 한국공항공사 주소를 바꿔야 할 때만 |
| `NAVER_MAP_CLIENT_ID`, `NAVER_MAP_CLIENT_SECRET` | 서버 | Directions 5 (Dynamic Map 과 같은 Application 의 키) |
| `VITE_NAVER_MAP_CLIENT_ID` | 브라우저(공개) | Dynamic Map. NAVER Cloud 콘솔에 Web 서비스 URL 등록 필수 |

## Agent 엔드포인트 (POST, 서버가 사실 데이터 준비 → OpenAI → 검증 → DB 저장)
| 엔드포인트 | 역할 | 비고 |
|---|---|---|
| `/api/adventures-generate` | GENERATE_ADVENTURES: 모험 3개 생성 | 후보 장소 15개 이하로 줄여 전달, recommendedPlaceIds 는 후보 안에서만, 최초 1세트 + 재생성 1세트, 실패 시 Demo Adventure |
| `/api/adventures-select` | 모험 선택 (proposed → selected) | |
| `/api/quests-generate` | GENERATE_QUESTS: 메인 1 + 챕터 2~4 + 챕터별 핵심 1 / 선택 pool 4~5 | 선택한 모험당 1회, 선택 퀘스트는 초기 3개만 공개(나머지 `is_hidden`), anchor(핵심 장소) 도보 범위 후보만 사용(아래 규칙), 실패 시 Demo Quests |
| `/api/quests-complete` | 퀘스트 완료 (직접 확인 self / GPS 인증 gps) | 핵심 완료 → 챕터 `core_completed`(자동으로 안 넘어감). EXP 지급 + 방문/발견 기록. 인증은 `api/_lib/quests/verification.js` 의 `resolveVerification` 한 곳. `{ method: 'gps', position }` 이면 서버가 거리(150m)/정확도/시각을 검증한다(실패 코드 `gps_too_far`·`gps_accuracy_low`·`gps_position_stale`). 자유여행 중에는 `free_travel_active` 로 막힌다. 사진 인증은 10단계 |
| `/api/chapters-advance` | 챕터 이동 버튼 1개의 서버 동작 | 핵심 미완료 → `skipped`(보너스 없음) / `core_completed` → `completed`(자유 EXP +20). 어느 쪽이든 남은 선택 퀘스트 종료, 다음 챕터 `active`, 마지막이면 모험 완료(+50, 건너뛴 챕터가 있으면 없음) |
| `/api/quests-reveal` | "퀘스트 더 받기": 숨긴 선택 퀘스트 공개 | AI 재호출 없음, 한 번에 2개, 진행 중인 챕터에서만 |
| `/api/free-travel-start` | 자유여행 시작 (모험은 그대로 `active`, `trips.travel_mode='free'`, 세션 생성) | 사용자당 진행 중인 세션 1개(멱등) |
| `/api/free-travel-finish` | 자유여행 종료 + 사용자가 고른 방문 확정 (`place_visits` + 발견) | 이동 경로는 검증에만 쓰고 저장하지 않는다. 방문 근거(evidence) `gps`/`route` 일 때만 발견 EXP, `none` 이면 방문만 저장 |
| `/api/quests-photo-verify` | 사진 인증 1회 (AI 판정 pass/uncertain/fail 또는 업로드만 확인) | 인증 사진은 저장하지 않고 분석 후 버린다. AI 판정은 퀘스트당 최대 2회, AI 장애는 2회까지 재시도 후 직접 확인 fallback. pass 면 같은 완료 흐름(EXP/방문/발견)으로 이어진다. Agent 한도와 별개(`jeju_api_usage_logs.purpose='photo_verification'`) |
| `/api/memories-save` | "추억으로 남기기": 사진 인증으로 완료한 퀘스트의 사진을 Storage(`travel-memories`)에 영구 저장 + `travel_photos` 기록 | 퀘스트당 1장, 중복 저장 안 됨 |
| `/api/adventures-replan` | REPLAN_ADVENTURE (사용자 승인 후에만): 남은 일정만 다시 설계 | reason 6종(SCHEDULE_AHEAD 제외). 완료 데이터 불변, 교체분은 삭제 없이 `replaced` 표시. 후보 없음 → `no_alternative`, 실패 → 기존 모험 유지. 하루 한도/cooldown/중복은 서버가 강제 |
| `/api/surprise-evaluate` | GENERATE_SURPRISE_QUEST: 안정적인 시점에서만 돌발 퀘스트 1개(또는 no_quest) | 코드 gate(이동 중/인증 중/REPLAN 필요/시간 부족/하루 3개/60분 cooldown) 통과 시에만 Agent 호출 |
| `/api/surprise-respond` | 돌발 퀘스트 도전하기/이번엔 지나가기 | 거절은 실패가 아님(불이익 없음) |
| `/api/exp-invest` | 자유 EXP 한 덩어리를 카테고리 하나에 전부 투자 | 일반 5개 카테고리만, 분할/중복 투자 불가 |

- 중복 호출/횟수 제한: `jeju_agent_requests` 의 `request_key`(= 여행/날짜/세트 번호) UNIQUE 로 DB 에서 막는다.
- 비용: 호출마다 `jeju_api_usage_logs` 에 model/input/output/cost(추정) 기록.
- 새 환경변수(서버 전용): `OPENAI_API_KEY`, `OPENAI_MODEL`(선택, 기본 `gpt-4.1-mini`), `SUPABASE_SERVICE_ROLE_KEY`.
- 진행 기록(quest_progress, 챕터/모험 상태)은 서버만 쓴다. 클라이언트는 읽기만 한다.

## AI(Agent) 호출 판단 원칙
| 동작 | 저장 | Agent 호출 |
|---|---|---|
| 홈에서 여행 정보 수정 (기간/숙소/항공편) → `jeju_update_trip_info` | DB | ❌ 없음 |
| 홈에서 오늘 조건 수정 / 모험 생성 전 조건 확인 (`jeju_daily_contexts`) | DB | ❌ 없음 |
| 새로운 하루의 모험 생성 ("오늘의 모험 만들기" → 조건 확인 → 저장 → 생성) | DB 저장 후 | ✅ GENERATE_ADVENTURES |
| "오늘 일정 다시 맞추기"를 사용자가 직접 선택 | — | ✅ REPLAN_ADVENTURE (본체는 11단계, 지금은 연결점만) |
| 그 외 정의된 REPLAN trigger (날씨 급변, 일정 지연 등) | — | 11단계 |

- 설정을 여러 번 고쳐도 Agent 는 호출되지 않는다. 오늘 진행 중인 모험이 있을 때 일정에 영향을 주는 값(동행/이동수단/종료 희망 시간/오늘 숙소)이 바뀌면 `jeju_daily_contexts.replan_pending = true` 로 "재계획 제안"만 남기고, 홈에 [다음 모험부터 반영] / [오늘 일정 다시 맞추기] 가 뜬다. 여러 번 수정해도 사용자가 고른 한 번만 요청된다.
- Agent context 는 호출될 때마다 trips / accommodations / daily contexts / 방문 / 피드백 / EXP 를 DB 에서 다시 읽는다. (수정값은 텍스트 피드백이 아니라 정식 DB 데이터로 반영)

## 일일 조건 (daily context)
- 여행 전체 정보(기간/숙소/출발 항공편) = `trips` / `accommodations`, 하루 단위 조건(동행·인원·이동수단·종료 희망 시간) = `jeju_daily_contexts` (UNIQUE(trip_id, context_date)). 행이 있는 날짜 = 사용자가 그날 조건을 확인한 날.
- 새 날짜 기본값(`src/utils/dailyContext.js` 의 `resolveDailyContext`, 서버/화면 공용): ① 그날 저장된 값 → ② 가장 최근의 이전 일일 조건 → ③ trips 기본값. 매일 다시 입력하지 않고, 달라진 것만 고친다.

## 추천 기준과 경험도
- `travel_preferences` = **관심도**(추천의 주된 기준). 카테고리 EXP/레벨 = **경험도**(얼마나 경험했는가). Agent context 에는 `preferences` 와 `experience`(level, tier) 가 따로 들어가고, 프롬프트는 경험도를 비율 결정이 아니라 입문/심화 조절·표현 깊이·반복 감소·새로운 형태 제안에만 쓰게 한다.
- 피드백: `jeju_feedback`(trip/adventure/quest 단위)을 읽어 최근 평가·코멘트와 "반복해서 높게/낮게 평가한 유형" 요약을 `userFeedback` 으로 전달한다. 저장 함수는 `feedbackRepo.saveFeedback`, 화면은 이후 단계.

## 챕터 상태 / EXP (8단계)
- 챕터: `locked → active → core_completed → completed` / `active → skipped`. 핵심 퀘스트 완료는 챕터 완료가 아니다. 화면은 현재 챕터 1개만 보여주고, 이동 버튼은 1개(상태에 따라 "이 챕터 건너뛰기" ↔ "다음 챕터로 진행")이며 누르면 확인 모달이 뜬다. 닫힌 챕터의 선택 퀘스트로는 돌아갈 수 없다.
- EXP 계산: `src/utils/exp.js` — `round(기본(10/20/30) × 유형(핵심1.5/선택1.0/돌발1.5) × 인증(self0.9/gps1.0/사진1.05/gps+사진1.1)) + 제한시간 성공 5`. 복합 카테고리는 총 EXP 를 `ceil/floor` 로 나눈다(합계 유지).
- 레벨: `src/utils/level.js` — DB 에 저장하지 않고 EXP 에서 계산. 일반 곡선 Lv.999, 발견 곡선 Lv.200, 종합은 6개 EXP 합.
- 지급 경로: `api/_lib/progression/exp.js` → DB 함수 `jeju_apply_exp` (한 트랜잭션: 중복 확인 → `exp_logs` → profile). 중복 방지는 `exp_logs.source_key` UNIQUE: `quest:{id}:completion` / `discovery:{placeId}` / `chapter:{id}:completion` / `adventure:{id}:completion` / `invest:{grantId}`.
- 방문/발견: 퀘스트 완료 시 `place_visits`(매번, 퀘스트당 1건) 기록, `place_discoveries`(평생 최초 1회, UNIQUE(user_id, place_id))일 때만 발견 EXP(+20, 명소 +35). 명소는 `jeju_landmarks` 표로만 정한다.
- 보안: EXP 컬럼/`unspent_exp` 는 클라이언트가 못 쓰고(컬럼 권한), `quest_progress` 쓰기도 서버만. EXP 함수는 `service_role` 전용.
- 칭호: `api/_lib/progression/titles.js` 에 해금 연결 지점만 있다(이름/조건 미확정).

## 퀘스트 규칙 (`QUEST_RULES`, `api/_lib/agent/quests.js`)
- **챕터 = anchor(핵심 장소) 하나, 또는 그 주변 도보 범위**에서 경험을 넓히는 단위. 챕터 안에서는 장소 다양성보다 동선이 자연스러운 게 우선.
- **선택 퀘스트**: 같은 장소(anchor)에서 하는 행동형을 우선. 다른 장소는 0~3곳이고 anchor 의 도보 범위(nearby) 안에서만 허용. 범위 밖 장소는 선택 퀘스트로 못 쓰고 다른 챕터 anchor 후보로 남는다. 한 장소를 다른 챕터에서 다시 쓰지 않는다.
- **도보 범위**: 지금은 직선거리 800m(선호 500m). `api/_lib/agent/walkability.js` 의 `walkAccess` 만 바꾸면 실제 도보 시간(`walkMaxMinutes`, 5~10분)으로 교체된다. 입력(anchors[].nearby)과 검증이 같은 목록을 쓴다.
- **카테고리**: 퀘스트 하나당 `category_primary` + `category_secondary`(nullable) 최대 2개. 챕터 전체 제한은 없다. 퀘스트 EXP 카테고리는 explore / culture / food / relax / social 5개뿐이고, **discovery 는 제외**(발견 EXP 는 8단계의 `jeju_place_discoveries` 평생 최초 방문으로만). 모험의 "대표 성향"과 성향 테스트는 기존 6축을 유지한다.
- **인증**: DB 의 `verification_type` 은 의도한 방식(gps / photo_* / self)을 그대로 저장하고, 화면은 9~10단계 전까지 "GPS/사진 인증 예정 · 직접 확인으로 완료"로 표시한다. 실제 완료 방식은 `quest_progress.verification_method`. 인증 검증은 `completeQuest` 의 `resolveVerification` 한 곳에 끼운다.

## Agent context 확장 구조 (`api/_lib/agent/context.js`)
모든 Agent 가 `buildAgentContext` 를 공유한다. 새 정보는 "part" 함수를 하나 추가해서 목록에 끼우면 된다.
| 정보 | 상태 | 출처 |
|---|---|---|
| 현재 날짜/시간/계절/위치/날씨/교통/동행/인원/성향 | 연결됨 | trips, preferences, 날씨 API |
| 오늘 숙소 / 숙소 변경 여부 | 연결됨 | `jeju_accommodations` (좌표가 있으면 후보 검색 기준 좌표로 사용) |
| 종료 희망 시간 / 출발 일시 | 연결됨 | `jeju_trips.desired_end_time`, `departure_datetime` |
| 이번 여행 방문 장소 | 조회 연결됨 (기록은 8단계) | `jeju_place_visits` → 후보에서 **제외** |
| 과거 여행 방문 장소 | 조회 연결됨 (기록은 8단계) | `jeju_place_visits` → 후보 **뒤로 + visitedBefore 표시** (약한 감점) |
| 사용자 피드백 | 조회 연결됨 (기록은 이후 단계) | `jeju_feedback` (comment 는 지시가 아닌 데이터로만 전달) |
| NAVER Directions 실제 이동시간 | **미연결** (`travelTimes: null`) | 9단계 `travelTimesPart` 구현 |

방문 기록 단계(8단계)에서 `jeju_place_visits` 에 기록만 쌓으면 GENERATE_ADVENTURES / GENERATE_QUESTS 후보에 자동 반영된다.

## 알아둘 사실 (실측)
- 공항 혼잡도 API 에는 **대기시간/보안검색 소요시간이 없다**. `latestSafeDepartureTime` 은 혼잡도 단계별 여유시간 표(gameBalance 상수)를 코드가 적용해 계산한다. (12단계)
- 항공편 조회는 편명(`flightNo`)이 필요하다. 여행 설정의 출발 항공편(`departure_flight`)을 쓴다.
- TAGO 도착정보/노선정보는 정류장 조회 응답의 `cityCode`, `stationId`, 도착정보 응답의 `routeId` 를 이어서 써야 한다.
- 날씨 응답의 `sky`/`precipitation.type` 은 코드 값(`clear`/`mostly_cloudy`/`cloudy`, `none`/`rain`/…)이다. 화면 문구는 UI 쪽에서 매핑한다.

## 새 API 추가 방법
1. `api/_lib/mock/` 에 데모 데이터, `api/_lib/providers/` 에 `runProvider({ live, mock })` 로 제공자 작성
2. `api/<name>.js` 에 `createHandler` 로 엔드포인트 작성 (파라미터는 `numberParam`/`stringParam` 으로 검증)
3. `src/services/<영역>/` 에 `apiGet('<name>', ...)` 호출 함수 작성
## GPS / 자유여행 (9단계)
- **설정 값**: `src/constants/locationRules.js` 한 곳. GPS 반경 150m(`GPS_QUEST_RADIUS_METERS`), 방문 후보 200m·5분(`FREE_VISIT_*`), 수동 방문 경로 허용 거리 3000m(`MANUAL_VISIT_ROUTE_MAX_DISTANCE_METERS`), 경로 기록 간격(`ROUTE_*`), 주변 장소 재조회 규칙(`NEARBY_*`), 복귀 판정 기준(`RETURN_RULES`).
- **위치**: 브라우저 Geolocation 은 `src/services/location/geolocation.js` → `src/hooks/useGeolocation.js` 로만 쓴다. 앱 시작 시 권한을 요청하지 않고, 내 위치 확인 / GPS 인증 / 자유여행 시작 때 처음 요청된다.
- **지도**: `src/components/map/NaverMapView.jsx`(NAVER Dynamic Map). 마커 모양은 `markerConfig.js` 한 곳(14단계 교체 지점). 키가 없거나 인증/로드에 실패하면 같은 정보를 목록으로 보여주고 앱은 계속 동작한다.
- **자유여행 상태**: `src/store/freeTravelStore.js` (idle → active → reviewing → returning). 경로/방문 후보는 프론트 세션(localStorage 디바운스 백업)에만 있다. DB 에는 방문/발견/세션 요약(숫자)만 남는다.
- **DB**: `supabase/008_free_travel_and_gps.sql` (퀘스트 장소 좌표, `jeju_free_sessions`, 방문 기록의 evidence/좌표/세션). 이 SQL 을 적용한 뒤에 새로 만든 퀘스트부터 GPS 인증을 쓸 수 있다.
- **호출량**: 자유여행 중 위치 갱신마다 하는 일은 메모리 계산뿐이다. TourAPI 는 거리(1.2km)/캐시 만료(15분)/최소 간격(2분)/실패 쿨다운을 통과할 때만, GPT·Directions 는 부르지 않는다.
- **REPLAN 연결점**: 복귀 판정(`src/utils/freeTravel/returnCheck.js`)이 어긋남을 찾고 사용자가 "일정 다시 맞추기"를 눌렀을 때만 `requestReplanAfterFreeTravel`(reason `RETURN_FROM_FREE_TRAVEL`)이 호출된다. 서버 본체는 11단계(지금은 501).
- **테스트**: `npm run test` (node:test, 순수 로직 + in-memory DB 로 서버 흐름 확인).

## 사진 인증 / 추억 (10단계)
- **인증 방식**: `api/_lib/quests/verification.js` 의 `resolveVerification` 한 곳. self / gps / photo(photo_upload·photo_ai) / gps_photo. 완료·EXP·방문·발견은 모두 `completeQuest` 하나를 거친다. 사진 인증 API 는 서버 내부에서만 검증 결과(`preverified`)를 넘긴다.
- **gps_photo**: GPS 와 사진이 **둘 다** 충족돼야 `verification_method=gps_photo` 로 최종 완료. 중간 상태는 `jeju_quest_progress.gps_verified_at / photo_verified_at`(status 는 in_progress). 중간 단계에서는 EXP 가 없고, 최종 완료 때 한 번만(`quest:{id}:completion`) 지급한다.
- **사진 확인 방식**: `ai_check`(AI 판정) / `upload_only`(올리면 성공). `photo_upload` 타입, 사람이 중심인 퀘스트(키워드/social), `quest.data.photoMode` 로 upload_only. 규칙은 `src/utils/photoMode.js`.
- **AI 판정**: `api/_lib/photo/judge.js` (`PhotoVerificationService`). OpenAI Responses API + 이미지 입력(`detail: low`) + JSON Schema(strict) → `{ result, reason }`. `store:false`, 짧은 출력 토큰 제한. 사람의 신원/나이/성별 추측 금지, 기준은 너그럽게.
- **2회 제한**: `photo_attempts` 를 AI 호출 **전에** 조건부 UPDATE 로 먼저 잡는다(동시 요청은 한쪽만 통과). 같은 `attemptId` 는 저장된 결과를 재사용. AI 장애는 횟수를 돌려주고 `photo_errors` 만 올리며 2회면 fallback.
- **직접 확인 fallback**: 사진 AI 를 다 쓰면(판정 2회 또는 장애 2회) self ×0.9, 발견 EXP 없음. (gps_photo 는 사진 통과 후 GPS 를 못 쓰는 경우에도 self 가능)
- **발견 EXP**: `DISCOVERY_ALLOWED_METHODS = ['gps','gps_photo']` — 사진 단독/ self 는 퀘스트 EXP 만.
- **이미지**: 브라우저가 긴 변 1280px / JPEG 0.8 로 줄여서 보낸다(`src/utils/imageResize.js`, 상수는 `photoRules.js`). EXIF 에 의존하지 않는다.
- **추억**: 인증용 사진은 임시(저장 안 함). 사용자가 `☆ 추억으로 남기기` 를 누르면 `{userId}/{tripId}/{uuid}.jpg` 로 private bucket `travel-memories` 에 저장. Storage RLS: 본인 폴더만 읽기/삭제, 업로드는 서버만. 기록/여행 요약용 조회는 `memoryRepo.fetchTripMemories`.
- **DB**: `supabase/009_photo_verification.sql`
- **개발 도구**(서비스 UX 에 노출되지 않음): `scripts/dev/photo-judge-check.mjs`(실제 AI 판정 확인), `scripts/dev/seed-photo-quest.mjs`(화면 시험용 임시 퀘스트 추가/삭제)

## REPLAN / 돌발 퀘스트 / 탭 전환 성능 (11단계)
- **규칙 상수**: `src/constants/replanRules.js` 한 곳. 판단 로직(순수 함수)은 `src/utils/schedule.js`(지연/앞당김/날씨/돌발 gate/핵심 퀘스트 수행 가능성)와 `src/utils/travel.js`(이동시간).
- **REPLAN 흐름**: 화면이 코드로 상황을 판단 → **제안**(기존 일정 계속 / 일정 다시 맞추기) → 사용자 **승인** → `/api/adventures-replan`. (REPLAN 1회 = 승인 1회) 구현: `api/_lib/agent/replan.js`.
  1. 하루 한도/cooldown 확인 → `request_key`(상태+reason)로 중복 차단 → 2. 현재 위치/시간/날씨/이동시간(Directions)/방문 기록으로 **현재 핵심 퀘스트 수행 가능성**을 코드가 판단(가능하면 유지) → 3. TourAPI 실제 후보를 코드가 필터(방문 제외/실내 여부/시간) → 4. 후보가 없으면 `no_alternative`(Agent 호출 없음) → 5. Agent 는 GENERATE_QUESTS 와 같은 프롬프트·검증으로 후보 안에서만 설계(예고한 다음 챕터는 `keepOrder` 로 보존) → 6. 새 챕터를 임시 seq 로 먼저 넣고, 교체되는 기존 일정은 `status='replaced'`/`replaced_at` 표시(삭제 안 함) → 7. 실패하면 새로 넣은 것만 되돌리고 기존 모험 유지.
- **불변(immutable)**: 완료한 챕터/퀘스트, EXP, 방문/발견, 추억 사진, 칭호. REPLAN 은 locked/available 챕터와 진행 기록이 없는 현재 챕터, 현재 챕터의 미완료 선택 퀘스트만 건드린다.
- **한도**: 시스템 제안 승인 실행 2회/수동 1회/일반 합계 3회/긴급(PLACE_UNAVAILABLE·ACCOMMODATION_RISK) 포함 4회, cooldown 시스템 30분·수동 15분. 실패/후보 없음은 한도를 쓰지 않는다.
- **일정 지연/앞당김**: 챕터마다 `activated_at`/`closed_at` 과 예상 소요(활동 60분 + 이동)를 비교. 지연 <15분 무시 / 20~30분 내부 확인 / 30분+ 이면서 종료 희망 시간을 넘길 때 제안 / 60분+ 강한 제안. 30분+ 빨라지면 REPLAN 이 아니라 Bonus Opportunity(퀘스트 더 받기 → 돌발 퀘스트 → 자유여행 → 그냥 다음 챕터).
- **날씨**: 캐시 25분, 챕터 전환/앱 복귀/자유여행 복귀/사용자 확인 때만 갱신. 강한 비/강풍/폭염/바람 동반 강추위만 major. 작은 변화는 무시.
- **돌발 퀘스트**: 챕터 비소속(`chapter_id` null), `surprise_status` offered→accepted/declined. 평가 시점은 핵심 퀘스트 완료 직후 / 챕터 퀘스트를 모두 끝낸 직후 / anchor 200m·3분 체류 / 일정 앞당김. 인증·EXP 는 기존 흐름(surprise ×1.5)을 그대로 쓴다.
- **탭 전환**: 퀘스트 판은 `useQuestBoard` + store 캐시(60초 stale, mutation 시 invalidate), 홈은 `tripStore.hub`, 방문한 장소는 캐시, NAVER 지도 인스턴스는 모듈에 보관해 재사용(SDK 재로드/재생성/마커 재구성 없음), GPS 는 마지막 위치를 즉시 쓰고 권한이 이미 허용된 경우에만 조용히 갱신.
- **DB**: `supabase/010_replan_and_surprise.sql` — 이 SQL 을 먼저 적용해야 퀘스트 화면이 동작한다(`replaced_at` 컬럼 조회).
- **개발 도구**: `scripts/dev/replan-agent-check.mjs`(실제 OpenAI 로 REPLAN·돌발 Agent 확인)

## 퀘스트 완료 API 성능 (`completeQuest`)
- **측정**: `node scripts/dev/completion-timing.mjs [지연ms]` (가짜 DB + 호출당 지연 시뮬레이션, 호출 수/직렬 왕복/소요 시간), `node --env-file=.env scripts/dev/db-latency.mjs` (실제 Supabase 읽기 1회 왕복, DB 를 바꾸지 않음). 테스트용 계측 래퍼는 `tests/helpers/instrumentDb.js`.
- **원칙**: 속도보다 무결성이 먼저. EXP source key / UNIQUE(user, place) / 진행 기록(커밋 지점) 구조는 그대로이고, 서로 의존하지 않는 DB 호출만 같은 단계에서 동시에 보낸다.
- **현재 단계 구성**: ① quest 읽기 → ② [모험→여행 ∥ 챕터 ∥ 진행 기록] 읽기 → ③ 퀘스트 EXP RPC ∥ 명소 조회 → ④ 방문 기록 ∥ 발견 RPC → ⑤ 진행 기록(커밋) → ⑥ 챕터 상태(핵심 퀘스트만).
  퀘스트 EXP RPC 와 발견 RPC 는 같은 profile row 를 잠그므로 절대 동시에 보내지 않는다.
- **레벨업**: 지급 전/후 EXP 스냅샷 조회(2회) 대신, DB 함수가 돌려주는 \`before\`/\`added\`(원장)로 기존 \`diffLevels\` 를 호출한다. (원장이 없는 구버전 DB 함수에서만 지급 후 1회 조회로 역산)
- **보류(14단계 이후 Performance Pass 후보)**: 완료 처리를 Postgres RPC 하나로 묶는 것(\`complete_quest_transaction\`).

## Final Quest / 여행 종료 / 여행 기록 (12단계)

- **migration**: `supabase/011_final_quest_and_trip_end.sql` (jeju_final_quests, `ended_by_final_quest`, trips.completed_at/retrospective, feedback 항목, 임시 칭호 seed). 적용 전에는 Final Quest 평가가 실패한다.
- **API**: `POST /api/final-quest {action: status|start|arrive|finish, tripId}`, `GET /api/trip-records[?tripId]`, `POST /api/trip-feedback`.
- **상태 흐름**: (없음) → notice(활성화 60분 전, 새 돌발 중단) → active(일반 모험 종료, 미완료 퀘스트 `ended_by_final_quest`) → moving → arrived(공항 500m GPS, +100 EXP 한 번) → finished(`trips.status='completed'`). 결항은 `flight_cancelled` 별도 상태(강제 이동/자동 종료 없음).
- **안전 시간(코드가 계산, GPT 불가)**: `src/utils/finalQuest.js` → `latestSafeDeparture = 출발 − (국내 90 / 국제 150분) − (공항 이동시간 + 혼잡 보정 0/0/30/60)`. 상수는 `src/constants/finalQuestRules.js`. 서버 평가는 `api/_lib/finalQuest/service.js`.
- **잠금**: `assertNoFinalQuest`(REPLAN/자유여행/새 모험·퀘스트 생성) + `assertFinalQuestGate`(Surprise, 준비 구간 포함). 새 외부 API 조회는 마지막 날에만, TTL 10분 캐시.
- **마지막 날 모험**: `src/utils/lastDay.js` (후보 공항 수렴 필터/정렬, 챕터 순서, 마지막 챕터→공항 60분 초과 시 단축).
- **기록**: 요약 수치는 저장하지 않고 `api/_lib/finalQuest/record.js`가 기존 표에서 조립. 회고는 `retrospective.js`(AI → 실패 시 코드 통계).
- **피드백→Agent**: `context.js`의 `userFeedback.summary.adjustments`(밀도/장소/난이도 → 조정 지시).

## 12단계 후속 (안정성 수정 + 퀘스트 탭 지도 UX)

- Final Quest 위치: 클라이언트가 최근(2분 이내) 위치를 `position`으로 전달(`finalQuestPosition.js`), 서버가 3분 이내만 인정(`usablePosition`). 우선순위 GPS → 챕터 핵심 장소 → 60분.
- 항공편 종류: `flightKind`('domestic'|'international'|'unknown'), unknown 은 150분. 직접 선택 값은 `override` 인자 자리.
- 여행 EXP 변화: `012_trip_exp_snapshot.sql`(`trips.exp_snapshot`) + 스냅샷 없으면 exp_logs 로 종료 시점 복원(`resolveExpRange`).
- 활성화 마감: `upsert(... ignoreDuplicates)` 로 기존 progress(완료 포함) 보존.
- 퀘스트 탭 지도: `QuestLocationRow`(접힘 기본) + `QuestMapPreview`(펼칠 때만 마운트, SDK는 `mapLoader` 공유) + `mapFocusStore` → `/map` 포커스.

## 완료 claim (Quest completion ↔ Final Quest race)

`completeQuest` 는 EXP 지급 **전에** progress 행을 `in_progress + verification_method` 로 claim 한다 (`claimCompletion`).
Final Quest 활성화는 claim 되지 않은(`verification_method` 가 null) in_progress/없는 행만 `ended_by_final_quest` 로 마감한다. 이미 마감된 퀘스트는 claim 이 `quest_closed` 로 실패해 EXP 를 주지 않는다.

## Stage 13: Agent Log / Fallback / Demo Mode

- **Agent Log**: `src/utils/agentLog.js`(모델/formatter) + `src/store/agentLogStore.js`(세션 메모리, 최대 150개, key 중복 방지) + `AgentLogPanel`(데스크톱 우측 패널, 모바일 오프캔버스). 연결 지점은 `apiClient` 공통 경로(모든 /api 응답) + REPLAN 제안(`useScheduleAssistant`) + 자유여행 복귀(`useFreeTravel`). DB 테이블 없음.
- **Fallback**: 서버 기존 구조(provider mock fallback, buildDemoAdventures/Quests, 재시도 1회)는 그대로. 응답의 `source/fallback/error/fallbackReason` 을 formatter 가 사람이 읽는 로그로 바꾼다. 화면에는 기술 오류 문구를 내지 않는다.
- **Demo Mode**: `/auth` 의 관리자 모드 버튼 → 시나리오 7종. 격리 경계는 3곳: `lib/supabaseClient.js`(from/rpc/storage 만 Demo 메모리 DB, auth 는 실제), `services/api/apiClient.js`(Demo 면 `src/demo/demoApi.js` 가 응답), `services/location/geolocation.js`(시뮬레이션 위치). 실제 Auth session 은 건드리지 않고 `useAuthStore` 가 읽을 때만 Demo 사용자로 보여준다. 코드: `src/demo/*`, `src/store/demoStore.js`.
