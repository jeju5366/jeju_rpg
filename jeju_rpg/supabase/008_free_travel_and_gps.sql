-- 9단계: GPS 인증 + 자유여행 (007 실행 후 한 번 실행. 여러 번 실행해도 안전)
-- additive migration: 기존 컬럼/데이터/정책은 바꾸지 않는다.
--
-- 원칙
--  * GPS 이동 경로(좌표 목록)는 DB 에 저장하지 않는다. 경로는 브라우저 세션에만 있고, 자유여행을 끝낼 때
--    방문 검증용으로 서버에 "한 번 전달"되지만 저장되지 않는다. DB 에는 의미 있는 이벤트(방문/발견/세션 요약)만 남긴다.
--  * 자유여행 중 현재 모험은 삭제/종료되지 않는다. jeju_trips.travel_mode(quest|free)만 바뀐다. (003 에 이미 있는 컬럼)
--  * 자유여행 시작/종료는 서버만 기록한다. (클라이언트는 SELECT 만)

-- ───────────── 퀘스트 장소 좌표 (GPS 인증의 목표 지점) ─────────────
-- GENERATE_QUESTS 가 저장할 때 TourAPI 후보의 좌표를 그대로 복사한다. (GPT 가 정하지 않는다)
-- 이 SQL 을 적용하기 전에 만들어진 퀘스트는 좌표가 비어 있고, 그런 퀘스트는 GPS 인증 없이 직접 확인으로만 완료된다.
alter table public.jeju_quests add column if not exists place_lat double precision;
alter table public.jeju_quests add column if not exists place_lng double precision;

alter table public.jeju_quests drop constraint if exists jeju_quests_place_lat_range;
alter table public.jeju_quests
  add constraint jeju_quests_place_lat_range check (place_lat is null or place_lat between -90 and 90);

alter table public.jeju_quests drop constraint if exists jeju_quests_place_lng_range;
alter table public.jeju_quests
  add constraint jeju_quests_place_lng_range check (place_lng is null or place_lng between -180 and 180);

alter table public.jeju_quests drop constraint if exists jeju_quests_place_latlng_pair;
alter table public.jeju_quests
  add constraint jeju_quests_place_latlng_pair check ((place_lat is null) = (place_lng is null));

-- ───────────── 자유여행 세션 ─────────────
-- 세션 1개 = 자유여행 시작 ~ 종료. 좌표는 저장하지 않고 요약(방문 수 등)만 남긴다.
create table if not exists public.jeju_free_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references public.jeju_trips (id) on delete cascade,
  adventure_id uuid references public.jeju_adventures (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary jsonb not null default '{}'::jsonb, -- { visitsSaved, candidatesSeen, routePoints } 같은 숫자 요약만
  created_at timestamptz not null default now()
);

-- 진행 중인 자유여행은 사용자당 1개. 더블 클릭/다른 탭에서 시작해도 세션이 두 개 생기지 않는다.
create unique index if not exists jeju_free_sessions_one_active_uidx
  on public.jeju_free_sessions (user_id) where status = 'active';
create index if not exists jeju_free_sessions_trip_idx on public.jeju_free_sessions (trip_id, started_at desc);

alter table public.jeju_free_sessions enable row level security;
drop policy if exists "jeju_free_sessions_select_own" on public.jeju_free_sessions;
create policy "jeju_free_sessions_select_own" on public.jeju_free_sessions
  for select using (auth.uid() = user_id);

-- ───────────── 방문 기록 확장 ─────────────
-- evidence: 이 방문을 뒷받침하는 위치 근거
--   gps   : 퀘스트 GPS 인증 / 자유여행 중 체류 감지(후보)를 사용자가 확인
--   route : 수동 기록이지만 자유여행 GPS 이동 경로 근처 장소
--   none  : 위치 근거 없음(수동 기록 + 경로 부족). 방문은 남기지만 발견 EXP 는 주지 않는다.
alter table public.jeju_place_visits add column if not exists evidence text;
alter table public.jeju_place_visits drop constraint if exists jeju_place_visits_evidence_check;
alter table public.jeju_place_visits
  add constraint jeju_place_visits_evidence_check check (evidence is null or evidence in ('gps', 'route', 'none'));

-- 지도의 "방문한 장소" 마커용 장소 좌표. (사용자의 이동 경로가 아니라 장소의 좌표다)
alter table public.jeju_place_visits add column if not exists place_lat double precision;
alter table public.jeju_place_visits add column if not exists place_lng double precision;

alter table public.jeju_place_visits
  add column if not exists free_session_id uuid references public.jeju_free_sessions (id) on delete set null;

-- 같은 자유여행에서 같은 장소를 두 번 저장하지 않는다. (재전송/더블 클릭 대비)
create unique index if not exists jeju_place_visits_free_session_uidx
  on public.jeju_place_visits (user_id, free_session_id, place_id)
  where free_session_id is not null;
