-- 12단계: Final Quest + 여행 종료 + Trip Summary + 여행 기록 + 피드백 + 임시 칭호
--  1) jeju_final_quests        : 여행당 1개의 Final Quest 상태 (활성화 시각 / 안전 시간 / 항공편 상태 / 공항 도착 / 마무리)
--  2) quest_progress / chapters : 'ended_by_final_quest' (여행 종료로 마감. 실패가 아니다)
--  3) jeju_trips                : completed_at + AI 회고(retrospective) — 요약 수치는 저장하지 않고 기존 표에서 조립한다
--  4) jeju_feedback             : 여행 피드백 항목(일정 밀도 / 추천 장소 / 퀘스트 난이도) + 여행당 1건
--  5) jeju_titles / user_titles : 임시 칭호 seed (이름/연출은 14단계에서 확정)
-- 여러 번 실행해도 안전하게(idempotent) 작성했다.

-- ───────────── 1) Final Quest ─────────────
-- status: active(공항 이동 안내) → moving(공항으로 이동 시작) → arrived(공항 도착, +100 EXP) → finished(여행 마무리)
-- flight_state 는 status 와 따로 둔다: 결항(cancelled)이어도 status 는 보존되고, 항공편 정보를 고치면 원래 흐름으로 돌아간다.
create table if not exists public.jeju_final_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references public.jeju_trips (id) on delete cascade,
  status text not null default 'active' check (status in ('active','moving','arrived','finished')),
  flight_state text not null default 'unknown' check (flight_state in ('normal','delayed','cancelled','unknown')),
  activation_reason text not null default 'safe_departure' check (activation_reason in ('safe_departure','unsafe_for_quests')),
  safe jsonb not null default '{}'::jsonb,        -- { departureAt, arriveBy, travelMinutes, congestionBufferMinutes, latestSafeDeparture, international, sources }
  ended_counts jsonb not null default '{}'::jsonb, -- 활성화로 마감된 퀘스트 수 { core, optional, surprise }
  activated_at timestamptz not null default now(),
  started_at timestamptz,
  arrived_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id)
);
create index if not exists jeju_final_quests_user_idx on public.jeju_final_quests (user_id);

alter table public.jeju_final_quests enable row level security;
drop policy if exists "jeju_final_quests_select_own" on public.jeju_final_quests;
create policy "jeju_final_quests_select_own" on public.jeju_final_quests for select using (auth.uid() = user_id);
-- INSERT/UPDATE 는 서버(service_role)만 한다. (EXP 지급과 같은 경로라 클라이언트 직접 쓰기 금지)

drop trigger if exists jeju_final_quests_updated_at on public.jeju_final_quests;
create trigger jeju_final_quests_updated_at before update on public.jeju_final_quests
  for each row execute function public.jeju_set_updated_at();

-- ───────────── 2) 여행 종료로 마감된 퀘스트/챕터 ─────────────
alter table public.jeju_quest_progress drop constraint if exists jeju_quest_progress_status_check;
alter table public.jeju_quest_progress
  add constraint jeju_quest_progress_status_check
  check (status in ('in_progress','completed','skipped','ended_by_final_quest'));

alter table public.jeju_chapters drop constraint if exists jeju_chapters_status_check;
alter table public.jeju_chapters
  add constraint jeju_chapters_status_check
  check (status in ('locked','available','active','core_completed','completed','skipped','replaced','ended_by_final_quest'));

-- ───────────── 3) 여행 기록 ─────────────
alter table public.jeju_trips add column if not exists completed_at timestamptz;
alter table public.jeju_trips add column if not exists retrospective text;
alter table public.jeju_trips add column if not exists retrospective_source text check (retrospective_source in ('ai','stats'));

-- ───────────── 4) 피드백 ─────────────
alter table public.jeju_feedback add column if not exists density text check (density in ('relaxed','fair','tight'));
alter table public.jeju_feedback add column if not exists places_rating text check (places_rating in ('good','ok','bad'));
alter table public.jeju_feedback add column if not exists difficulty text check (difficulty in ('easy','fair','hard'));
alter table public.jeju_feedback add column if not exists updated_at timestamptz not null default now();
-- 여행 피드백(퀘스트/모험에 안 붙은 것)은 여행당 1건. 다시 저장하면 덮어쓴다.
create unique index if not exists jeju_feedback_trip_uidx
  on public.jeju_feedback (user_id, trip_id)
  where quest_id is null and adventure_id is null and trip_id is not null;

-- ───────────── 5) 임시 칭호 ─────────────
alter table public.jeju_user_titles add column if not exists trip_id uuid references public.jeju_trips (id) on delete set null;

-- 이름/설명은 임시(14단계 Pixel RPG 에서 확정). code 와 조건(threshold)이 기준이다.
insert into public.jeju_titles (code, title_type, category, threshold, name) values
  ('trip_first_complete', 'behavior', null, 1, '제주 첫 모험 완료'),
  ('trip_explorer',       'behavior', 'explore', 3, '탐험형 여행자'),
  ('trip_foodie',         'behavior', 'food', 3, '미식 여행자'),
  ('trip_discoverer',     'behavior', 'discovery', 3, '발견가'),
  ('trip_quest_master',   'behavior', null, 10, '퀘스트 완주자')
on conflict (code) do nothing;
