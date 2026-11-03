-- 8단계 보강: 일일 여행 조건 / 피드백 연결 / 여행 정보 수정 / EXP 중복 방지 강화
-- 006 실행 후 한 번 실행. 여러 번 실행해도 안전, 기존 데이터 유지.
--  1) jeju_daily_contexts : 하루 단위 조건(동행/인원/이동수단/종료 희망 시간). 여행 전체 정보(trips/accommodations)와 분리
--  2) jeju_feedback.quest_id : 퀘스트 단위 피드백도 저장할 수 있게 연결 (UI 는 이후 단계)
--  3) jeju_update_trip_info : 여행 기간/숙소/항공편 수정을 한 트랜잭션으로 (DB 저장만, AI 호출 없음)
--  4) EXP 중복 방지 강화 (006 검증에서 발견한 문제 수정)
--      - 같은 자유 EXP 덩어리를 카테고리를 바꿔 두 번 투자할 수 있던 문제
--      - 같은 source_key 로 카테고리 구성이 달라진 재시도가 중복 지급될 수 있던 문제

-- ───────────── 1) 일일 여행 조건 ─────────────
-- 여행 전체에 속하는 정보(기간/숙소/항공편)는 trips / accommodations 가 관리하고,
-- 하루마다 달라질 수 있는 값만 여기에 둔다. 저장된 행이 있는 날짜 = 사용자가 그날 조건을 확인한 날.
-- 새 날짜의 기본값은 (1) 가장 최근의 이전 일일 조건 → (2) trips 기본값 순서로 앱/서버가 채운다. (행은 사용자가 저장할 때만 생긴다)
create table if not exists public.jeju_daily_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references public.jeju_trips (id) on delete cascade,
  context_date date not null,
  companion text not null check (companion in ('solo','couple','friends','family','other')),
  party_size integer not null default 1 check (party_size between 1 and 50),
  transport text not null check (transport in ('rental_car','public_transit','taxi','bike','walk')),
  desired_end_time time,
  -- 오늘 일정에 영향을 주는 값이 바뀌었는데 이미 오늘의 모험이 있으면 true. 사용자가 "다음 모험부터 반영" / "오늘 일정 다시 맞추기"를 고를 때 내려간다.
  replan_pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, context_date)
);

create index if not exists jeju_daily_contexts_trip_idx on public.jeju_daily_contexts (trip_id, context_date desc);

drop trigger if exists jeju_daily_contexts_updated_at on public.jeju_daily_contexts;
create trigger jeju_daily_contexts_updated_at before update on public.jeju_daily_contexts
  for each row execute function public.jeju_set_updated_at();

alter table public.jeju_daily_contexts enable row level security;
drop policy if exists "jeju_daily_contexts_select_own" on public.jeju_daily_contexts;
drop policy if exists "jeju_daily_contexts_insert_own" on public.jeju_daily_contexts;
drop policy if exists "jeju_daily_contexts_update_own" on public.jeju_daily_contexts;
drop policy if exists "jeju_daily_contexts_delete_own" on public.jeju_daily_contexts;
create policy "jeju_daily_contexts_select_own" on public.jeju_daily_contexts
  for select using (auth.uid() = user_id);
create policy "jeju_daily_contexts_insert_own" on public.jeju_daily_contexts
  for insert with check (auth.uid() = user_id);
create policy "jeju_daily_contexts_update_own" on public.jeju_daily_contexts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jeju_daily_contexts_delete_own" on public.jeju_daily_contexts
  for delete using (auth.uid() = user_id);

-- ───────────── 2) 피드백: 퀘스트 단위 연결 ─────────────
-- 피드백은 trip / adventure / quest 단위로 저장할 수 있고, 다음 GENERATE_* 요청의 context 에 요약되어 들어간다.
alter table public.jeju_feedback
  add column if not exists quest_id uuid references public.jeju_quests (id) on delete set null;

-- ───────────── 3) 여행 정보 수정 (기간 / 숙소 / 항공편) ─────────────
-- 저장만 한다. 이 함수와 이 함수를 부르는 화면은 Agent 를 호출하지 않는다.
-- p_trip        : { start_date?, end_date?, arrival_flight?, departure_flight?, departure_datetime? }  (키가 있는 것만 바뀜, 빈 문자열은 null)
-- p_accommodations: [{ id?, name, address?, check_in, check_out }]  — id 가 있으면 수정, 없으면 추가, 목록에 없는 기존 숙소는 삭제
--   주소가 바뀐 숙소는 좌표(latitude/longitude)를 비운다. (지도 단계에서 다시 채움)
create or replace function public.jeju_update_trip_info(p_trip_id uuid, p_trip jsonb, p_accommodations jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_start date;
  v_end date;
  v_item jsonb;
  v_id uuid;
  v_keep uuid[] := '{}';
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  perform 1 from public.jeju_trips where id = p_trip_id and user_id = v_user for update;
  if not found then
    raise exception 'trip_not_found';
  end if;
  if p_accommodations is null or jsonb_typeof(p_accommodations) <> 'array'
     or jsonb_array_length(p_accommodations) = 0 then
    raise exception 'at least one accommodation is required';
  end if;

  update public.jeju_trips set
    start_date = coalesce((p_trip ->> 'start_date')::date, start_date),
    end_date = coalesce((p_trip ->> 'end_date')::date, end_date),
    arrival_flight = case when p_trip ? 'arrival_flight' then nullif(btrim(p_trip ->> 'arrival_flight'), '') else arrival_flight end,
    departure_flight = case when p_trip ? 'departure_flight' then nullif(btrim(p_trip ->> 'departure_flight'), '') else departure_flight end,
    departure_datetime = case when p_trip ? 'departure_datetime' then nullif(p_trip ->> 'departure_datetime', '')::timestamptz else departure_datetime end
  where id = p_trip_id and user_id = v_user
  returning start_date, end_date into v_start, v_end;

  for v_item in select * from jsonb_array_elements(p_accommodations) loop
    if (v_item ->> 'check_in')::date < v_start or (v_item ->> 'check_out')::date > v_end then
      raise exception 'accommodation_out_of_range';
    end if;
    v_id := nullif(v_item ->> 'id', '')::uuid;

    if v_id is not null then
      update public.jeju_accommodations set
        latitude  = case when coalesce(address, '') <> coalesce(nullif(btrim(v_item ->> 'address'), ''), '') then null else latitude end,
        longitude = case when coalesce(address, '') <> coalesce(nullif(btrim(v_item ->> 'address'), ''), '') then null else longitude end,
        name = btrim(v_item ->> 'name'),
        address = nullif(btrim(v_item ->> 'address'), ''),
        check_in = (v_item ->> 'check_in')::date,
        check_out = (v_item ->> 'check_out')::date
      where id = v_id and trip_id = p_trip_id and user_id = v_user;
      if not found then
        raise exception 'accommodation_not_found';
      end if;
    else
      insert into public.jeju_accommodations (trip_id, user_id, name, address, check_in, check_out)
      values (
        p_trip_id, v_user, btrim(v_item ->> 'name'), nullif(btrim(v_item ->> 'address'), ''),
        (v_item ->> 'check_in')::date, (v_item ->> 'check_out')::date
      )
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.jeju_accommodations
   where trip_id = p_trip_id and user_id = v_user and not (id = any (v_keep));
end;
$$;

revoke all on function public.jeju_update_trip_info(uuid, jsonb, jsonb) from public;
grant execute on function public.jeju_update_trip_info(uuid, jsonb, jsonb) to authenticated;

-- ───────────── 4) EXP 중복 방지 강화 ─────────────
-- 같은 자유 EXP 덩어리는 카테고리와 관계없이 한 번만 투자할 수 있다. (DB 레벨 보장)
create unique index if not exists jeju_exp_logs_invest_once_uidx
  on public.jeju_exp_logs (user_id, source_id)
  where source_type = 'free_exp_invest';

-- jeju_apply_exp: 같은 source_key 로 이미 지급된 적이 있으면 카테고리 구성과 상관없이 아무것도 하지 않는다.
create or replace function public.jeju_apply_exp(
  p_user uuid, p_source_type text, p_source_id text, p_source_key text, p_parts jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.jeju_profiles%rowtype;
  v_part record;
  v_rows integer;
  v_awarded boolean := false;
  v_key text;
  v_before jsonb;
  v_add jsonb := '{"explore":0,"culture":0,"food":0,"relax":0,"social":0,"discovery":0,"unspent":0}'::jsonb;
begin
  select * into v_profile from public.jeju_profiles where id = p_user for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  v_before := jsonb_build_object(
    'explore', v_profile.exp_explore, 'culture', v_profile.exp_culture, 'food', v_profile.exp_food,
    'relax', v_profile.exp_relax, 'social', v_profile.exp_social, 'discovery', v_profile.exp_discovery,
    'unspent', v_profile.unspent_exp
  );

  -- 프로필 행을 잠근 상태라 동시 요청도 여기서 순서대로 처리된다.
  if exists (select 1 from public.jeju_exp_logs where user_id = p_user and source_key = p_source_key) then
    return jsonb_build_object('awarded', false, 'before', v_before, 'added', v_add);
  end if;

  for v_part in select * from jsonb_to_recordset(p_parts) as x(category text, amount integer) loop
    if v_part.amount is null or v_part.amount <= 0 then
      raise exception 'invalid_amount';
    end if;

    insert into public.jeju_exp_logs (user_id, category, amount, source_type, source_id, source_key)
    values (p_user, v_part.category, v_part.amount, p_source_type, p_source_id, p_source_key)
    on conflict (user_id, source_key, (coalesce(category, ''))) do nothing;
    get diagnostics v_rows = row_count;

    if v_rows > 0 then
      v_awarded := true;
      v_key := coalesce(v_part.category, 'unspent');
      v_add := jsonb_set(v_add, array[v_key], to_jsonb((v_add ->> v_key)::integer + v_part.amount));
    end if;
  end loop;

  if v_awarded then
    update public.jeju_profiles set
      exp_explore   = exp_explore   + (v_add ->> 'explore')::integer,
      exp_culture   = exp_culture   + (v_add ->> 'culture')::integer,
      exp_food      = exp_food      + (v_add ->> 'food')::integer,
      exp_relax     = exp_relax     + (v_add ->> 'relax')::integer,
      exp_social    = exp_social    + (v_add ->> 'social')::integer,
      exp_discovery = exp_discovery + (v_add ->> 'discovery')::integer,
      unspent_exp   = unspent_exp   + (v_add ->> 'unspent')::integer
    where id = p_user;
  end if;

  return jsonb_build_object('awarded', v_awarded, 'before', v_before, 'added', v_add);
end;
$$;

-- jeju_invest_exp: 이미 투자된 덩어리면(카테고리와 무관) 아무것도 하지 않는다.
create or replace function public.jeju_invest_exp(p_user uuid, p_grant_id uuid, p_category text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.jeju_profiles%rowtype;
  v_grant public.jeju_exp_logs%rowtype;
  v_rows integer;
begin
  if p_category not in ('explore', 'culture', 'food', 'relax', 'social') then
    raise exception 'invalid_category';
  end if;

  select * into v_profile from public.jeju_profiles where id = p_user for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  select * into v_grant from public.jeju_exp_logs
   where id = p_grant_id and user_id = p_user and category is null and amount > 0
     and source_type in ('chapter_complete', 'adventure_complete', 'final_complete');
  if not found then
    raise exception 'grant_not_found';
  end if;

  if exists (
    select 1 from public.jeju_exp_logs
     where user_id = p_user and source_type = 'free_exp_invest' and source_id = p_grant_id::text
  ) then
    return jsonb_build_object('invested', false);
  end if;

  insert into public.jeju_exp_logs (user_id, category, amount, source_type, source_id, source_key)
  values (p_user, p_category, v_grant.amount, 'free_exp_invest', p_grant_id::text, 'invest:' || p_grant_id)
  on conflict do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('invested', false);
  end if;
  if v_profile.unspent_exp < v_grant.amount then
    raise exception 'insufficient_unspent';
  end if;

  execute format(
    'update public.jeju_profiles set unspent_exp = unspent_exp - $1, %I = %I + $1 where id = $2',
    'exp_' || p_category, 'exp_' || p_category
  ) using v_grant.amount, p_user;

  return jsonb_build_object(
    'invested', true,
    'amount', v_grant.amount,
    'category', p_category,
    'before', jsonb_build_object(
      'explore', v_profile.exp_explore, 'culture', v_profile.exp_culture, 'food', v_profile.exp_food,
      'relax', v_profile.exp_relax, 'social', v_profile.exp_social, 'discovery', v_profile.exp_discovery,
      'unspent', v_profile.unspent_exp
    ),
    'added', jsonb_build_object(p_category, v_grant.amount, 'unspent', -v_grant.amount)
  );
end;
$$;

-- 권한은 006 과 같다: 서버(service_role)만 실행.
revoke all on function public.jeju_apply_exp(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.jeju_invest_exp(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.jeju_apply_exp(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.jeju_invest_exp(uuid, uuid, text) to service_role;
