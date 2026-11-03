-- 4단계: 핵심 DB migration / RLS  (001, 002 실행 후 한 번 실행. 여러 번 실행해도 안전)
-- 다른 프로젝트 테이블과 겹치지 않도록 jeju_ 접두사를 쓴다.
--
-- 원칙
--  * 레벨 컬럼 저장 금지(EXP로 계산). total_exp 별도 누적 금지(6개 EXP 합).
--  * place_visits(방문 반복 기록)와 place_discoveries(평생 최초 발견)는 합치지 않는다.
--  * 사용자 데이터는 RLS 로 auth.uid() 기준 보호한다.
--  * Agent/서버가 만드는 데이터(adventures, chapters, quests, exp_logs, place_discoveries,
--    agent_requests, api_usage_logs 등)는 클라이언트에 SELECT 만 열고,
--    쓰기는 서버(service_role)가 한다. 클라이언트 쓰기가 필요한 단계에서 정책을 추가한다.
--  * 상태값은 enum 타입 대신 text + CHECK (변경이 쉽도록).

-- ───────────── trips / accommodations ─────────────
-- 계절은 저장하지 않는다(날짜로 계산해서 Agent 에 전달).
create table if not exists public.jeju_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  companion text not null check (companion in ('solo','couple','friends','family','other')),
  transport text not null check (transport in ('rental_car','public_transit','taxi','bike','walk')),
  arrival_flight text,
  departure_flight text,
  status text not null default 'upcoming' check (status in ('upcoming','active','completed','ended_early')),
  travel_mode text not null default 'quest' check (travel_mode in ('quest','free')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- 날짜별 숙소 변경 지원: 여행 1개에 숙소 여러 개.
create table if not exists public.jeju_accommodations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.jeju_trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  check_in date not null,
  check_out date not null,
  created_at timestamptz not null default now(),
  check (check_out >= check_in)
);

-- ───────────── adventures / chapters / quests ─────────────
create table if not exists public.jeju_adventures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references public.jeju_trips (id) on delete cascade,
  adventure_date date not null,
  title text not null,
  summary text,
  travel_range text check (travel_range in ('near','normal','anywhere')),
  status text not null default 'proposed'
    check (status in ('proposed','selected','active','paused','completed','ended_early')),
  generation_set smallint not null default 1 check (generation_set in (1, 2)),
  data jsonb not null default '{}'::jsonb, -- Agent 출력 원본(검증 통과분)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jeju_chapters (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references public.jeju_adventures (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seq smallint not null check (seq >= 1),
  title text not null,
  summary text,
  status text not null default 'locked'
    check (status in ('locked','available','active','completed','skipped')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adventure_id, seq)
);

-- 메인 퀘스트는 chapter_id 가 null. 선택 퀘스트는 택1이 아니다(모두 수행 가능).
-- is_hidden: "퀘스트 더 받기"에서 AI 재호출 없이 공개하는 선택 퀘스트 pool.
create table if not exists public.jeju_quests (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references public.jeju_adventures (id) on delete cascade,
  chapter_id uuid references public.jeju_chapters (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  quest_type text not null check (quest_type in ('main','core','optional','surprise','final')),
  title text not null,
  description text,
  difficulty text not null default 'normal' check (difficulty in ('easy','normal','hard')),
  category text check (category in ('explore','culture','food','relax','social','discovery')),
  verification_type text not null default 'self'
    check (verification_type in ('self','gps','photo_upload','photo_ai','gps_photo')),
  verification_target text,
  place_id text,
  place_name text,
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes > 0),
  is_hidden boolean not null default false,
  seq smallint not null default 1,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 진행/인증. 획득 EXP 는 여기에 저장하지 않고 exp_logs 로 추적한다.
create table if not exists public.jeju_quest_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quest_id uuid not null references public.jeju_quests (id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','completed','skipped')),
  verification_method text check (verification_method in ('self','gps','photo_upload','photo_ai','gps_photo')),
  photo_attempts smallint not null default 0 check (photo_attempts between 0 and 2), -- 사진 AI: 최초1+재시도1
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, quest_id)
);

-- ───────────── 방문 / 발견 ─────────────
-- 방문: 실제 방문 반복 기록
create table if not exists public.jeju_place_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.jeju_trips (id) on delete set null,
  quest_id uuid references public.jeju_quests (id) on delete set null,
  place_id text not null,
  place_name text,
  visit_source text not null check (visit_source in ('quest','gps','manual')),
  visited_at timestamptz not null default now()
);

-- 발견: 평생 최초 1회. EXP 는 최초 1회만.
create table if not exists public.jeju_place_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  place_id text not null,
  place_name text,
  discovery_type text not null default 'normal' check (discovery_type in ('normal','landmark')),
  discovered_at timestamptz not null default now(),
  unique (user_id, place_id)
);

-- ───────────── EXP 감사 로그 ─────────────
-- category 가 null 이면 미투자(자유) EXP. 같은 source 중복 지급은 UNIQUE 로 막는다.
create table if not exists public.jeju_exp_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text check (category in ('explore','culture','food','relax','social','discovery')),
  amount integer not null check (amount <> 0),
  source_type text not null
    check (source_type in ('quest','discovery','chapter_complete','adventure_complete','final_complete','free_exp_invest')),
  source_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

-- ───────────── 칭호 (구조만, 실제 이름 목록은 추후) ─────────────
create table if not exists public.jeju_titles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title_type text not null check (title_type in ('total_level','category_level','discovery_level','behavior')),
  category text check (category in ('explore','culture','food','relax','social','discovery')),
  threshold integer, -- 필요 레벨 또는 횟수
  name text,         -- 미확정이면 null
  created_at timestamptz not null default now()
);

-- 획득한 칭호. 장착(current_title)은 사용자가 직접 선택하며 자동 장착 금지.
create table if not exists public.jeju_user_titles (
  user_id uuid not null references auth.users (id) on delete cascade,
  title_id uuid not null references public.jeju_titles (id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, title_id)
);

-- ───────────── 사진 / 피드백 ─────────────
-- 인증 사진은 기본 영구 저장 안 함. "추억으로 저장"한 사진만 storage_path 를 가진다.
create table if not exists public.jeju_travel_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.jeju_trips (id) on delete set null,
  quest_id uuid references public.jeju_quests (id) on delete set null,
  is_memory boolean not null default false,
  storage_path text,
  verification_result text check (verification_result in ('pass','uncertain','fail')),
  verification_reason text,
  created_at timestamptz not null default now(),
  check (not is_memory or storage_path is not null)
);

create table if not exists public.jeju_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.jeju_trips (id) on delete set null,
  adventure_id uuid references public.jeju_adventures (id) on delete set null,
  rating smallint check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- ───────────── Agent / 비용 로그 ─────────────
-- request_key 로 중복 호출을 서버에서 차단한다(idempotency).
create table if not exists public.jeju_agent_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.jeju_trips (id) on delete set null,
  adventure_id uuid references public.jeju_adventures (id) on delete set null,
  request_type text not null
    check (request_type in ('GENERATE_ADVENTURES','GENERATE_QUESTS','REPLAN_ADVENTURE','GENERATE_SURPRISE_QUEST','FINAL_QUEST')),
  request_key text not null,
  status text not null default 'pending' check (status in ('pending','success','failed','fallback')),
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique (user_id, request_key)
);

create table if not exists public.jeju_api_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_request_id uuid references public.jeju_agent_requests (id) on delete set null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

-- ───────────── 인덱스 ─────────────
create index if not exists jeju_trips_user_idx on public.jeju_trips (user_id, start_date desc);
create index if not exists jeju_accommodations_trip_idx on public.jeju_accommodations (trip_id);
create index if not exists jeju_adventures_trip_idx on public.jeju_adventures (trip_id, adventure_date);
create index if not exists jeju_chapters_adventure_idx on public.jeju_chapters (adventure_id, seq);
create index if not exists jeju_quests_adventure_idx on public.jeju_quests (adventure_id);
create index if not exists jeju_quests_chapter_idx on public.jeju_quests (chapter_id);
create index if not exists jeju_quest_progress_user_idx on public.jeju_quest_progress (user_id);
create index if not exists jeju_place_visits_user_idx on public.jeju_place_visits (user_id, place_id);
create index if not exists jeju_exp_logs_user_idx on public.jeju_exp_logs (user_id, created_at desc);
create index if not exists jeju_travel_photos_user_idx on public.jeju_travel_photos (user_id);
create index if not exists jeju_agent_requests_user_idx on public.jeju_agent_requests (user_id, created_at desc);
create index if not exists jeju_api_usage_logs_user_idx on public.jeju_api_usage_logs (user_id, created_at desc);

-- ───────────── updated_at 트리거 (함수는 001 에서 생성) ─────────────
do $$
declare t text;
begin
  foreach t in array array['jeju_trips','jeju_adventures','jeju_chapters','jeju_quests','jeju_quest_progress'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.jeju_set_updated_at()',
      t || '_updated_at', t);
  end loop;
end $$;

-- ───────────── RLS ─────────────
do $$
declare t text;
begin
  -- 모든 테이블 RLS 활성화
  foreach t in array array[
    'jeju_trips','jeju_accommodations','jeju_adventures','jeju_chapters','jeju_quests',
    'jeju_quest_progress','jeju_place_visits','jeju_place_discoveries','jeju_exp_logs',
    'jeju_titles','jeju_user_titles','jeju_travel_photos','jeju_feedback',
    'jeju_agent_requests','jeju_api_usage_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- 본인 행 SELECT (user_id 컬럼이 있는 모든 테이블)
  foreach t in array array[
    'jeju_trips','jeju_accommodations','jeju_adventures','jeju_chapters','jeju_quests',
    'jeju_quest_progress','jeju_place_visits','jeju_place_discoveries','jeju_exp_logs',
    'jeju_user_titles','jeju_travel_photos','jeju_feedback','jeju_agent_requests','jeju_api_usage_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id)', t || '_select_own', t);
  end loop;

  -- 본인 행 INSERT: 클라이언트가 직접 기록하는 테이블만
  foreach t in array array[
    'jeju_trips','jeju_accommodations','jeju_quest_progress','jeju_place_visits',
    'jeju_travel_photos','jeju_feedback'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id)', t || '_insert_own', t);
  end loop;

  -- 본인 행 UPDATE
  foreach t in array array['jeju_trips','jeju_accommodations','jeju_quest_progress','jeju_travel_photos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
  end loop;

  -- 본인 행 DELETE
  foreach t in array array['jeju_trips','jeju_accommodations','jeju_travel_photos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id)', t || '_delete_own', t);
  end loop;
end $$;

-- 칭호 정의는 모든 로그인 사용자가 읽을 수 있다(쓰기는 서버만).
drop policy if exists "jeju_titles_select_authenticated" on public.jeju_titles;
create policy "jeju_titles_select_authenticated" on public.jeju_titles
  for select to authenticated using (true);

-- ───────────── 여행 설정 저장 RPC ─────────────
-- trips + accommodations + onboarding_completed 를 한 트랜잭션으로 처리한다.
-- security invoker 이므로 위 RLS(본인 데이터만)가 그대로 적용된다.
create or replace function public.jeju_save_trip_setup(p_trip jsonb, p_accommodations jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_trip_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_accommodations is null or jsonb_typeof(p_accommodations) <> 'array'
     or jsonb_array_length(p_accommodations) = 0 then
    raise exception 'at least one accommodation is required';
  end if;

  insert into public.jeju_trips (user_id, start_date, end_date, companion, transport, arrival_flight, departure_flight)
  values (
    v_user,
    (p_trip ->> 'start_date')::date,
    (p_trip ->> 'end_date')::date,
    p_trip ->> 'companion',
    p_trip ->> 'transport',
    nullif(btrim(p_trip ->> 'arrival_flight'), ''),
    nullif(btrim(p_trip ->> 'departure_flight'), '')
  )
  returning id into v_trip_id;

  insert into public.jeju_accommodations (trip_id, user_id, name, check_in, check_out)
  select v_trip_id, v_user, btrim(a ->> 'name'), (a ->> 'check_in')::date, (a ->> 'check_out')::date
    from jsonb_array_elements(p_accommodations) as a;

  update public.jeju_profiles set onboarding_completed = true where id = v_user;

  return v_trip_id;
end;
$$;

revoke all on function public.jeju_save_trip_setup(jsonb, jsonb) from public;
grant execute on function public.jeju_save_trip_setup(jsonb, jsonb) to authenticated;
