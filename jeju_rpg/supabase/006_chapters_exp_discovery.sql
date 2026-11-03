-- 7단계 최종 보강 + 8단계(EXP / 발견 / 방문): 005 실행 후 한 번 실행. 여러 번 실행해도 안전, 기존 데이터 유지.
--  1) 챕터 상태에 core_completed 추가 (핵심 퀘스트 완료 ≠ 챕터 완료)
--  2) jeju_exp_logs: source_key 로 중복 지급 방지 (복합 카테고리는 카테고리별로 행을 나눠 저장)
--  3) 방문: 퀘스트 1개당 방문 1건만 (더블 클릭 방지), 명소 whitelist(jeju_landmarks)
--  4) 보안: EXP 컬럼/진행 기록은 클라이언트가 직접 못 쓰게 잠금 (EXP 는 서버 함수만 지급)
--  5) EXP 지급 / 발견 / 자유 EXP 투자를 한 트랜잭션으로 처리하는 DB 함수 (service_role 전용)
-- 레벨은 저장하지 않는다. EXP 에서 계산한다 (src/utils/level.js).

-- ───────────── 1) 챕터 상태 ─────────────
-- locked → active → core_completed(핵심 완료, 같은 챕터에 머무는 상태) → completed
--                 ↘ skipped (핵심 미완료 상태에서 건너뜀)
alter table public.jeju_chapters drop constraint if exists jeju_chapters_status_check;
alter table public.jeju_chapters
  add constraint jeju_chapters_status_check
  check (status in ('locked','available','active','core_completed','completed','skipped'));

-- ───────────── 2) exp_logs 중복 지급 방지 ─────────────
-- source_key 예: quest:{questId}:completion / discovery:{placeId} / chapter:{chapterId}:completion /
--                adventure:{adventureId}:completion / invest:{grantLogId}
-- 같은 source_key 는 (카테고리별로) 한 번만 저장된다. 복합 카테고리 퀘스트는 카테고리마다 1행.
alter table public.jeju_exp_logs add column if not exists source_key text;
update public.jeju_exp_logs set source_key = source_type || ':' || source_id where source_key is null;
alter table public.jeju_exp_logs alter column source_key set not null;

alter table public.jeju_exp_logs drop constraint if exists jeju_exp_logs_user_id_source_type_source_id_key;
create unique index if not exists jeju_exp_logs_source_key_uidx
  on public.jeju_exp_logs (user_id, source_key, (coalesce(category, '')));

-- ───────────── 3) 방문 / 명소 ─────────────
-- 방문(place_visits)은 같은 장소를 여러 번 기록할 수 있지만, 같은 퀘스트 완료로는 한 번만 기록한다.
create unique index if not exists jeju_place_visits_quest_uidx
  on public.jeju_place_visits (user_id, quest_id)
  where visit_source = 'quest' and quest_id is not null;

-- 명소(landmark) whitelist. 명소 여부는 LLM 이 판단하지 않고 이 표(서버/DB)로만 정한다.
-- 실제 TourAPI contentid 는 여기에 insert 해서 추가한다. (아래 demo-* 는 mock/데모 장소용)
create table if not exists public.jeju_landmarks (
  place_id text primary key,
  place_name text,
  created_at timestamptz not null default now()
);
alter table public.jeju_landmarks enable row level security;
drop policy if exists "jeju_landmarks_select_authenticated" on public.jeju_landmarks;
create policy "jeju_landmarks_select_authenticated" on public.jeju_landmarks
  for select to authenticated using (true);

insert into public.jeju_landmarks (place_id, place_name) values
  ('demo-seongsan', '성산일출봉 (데모)'),
  ('demo-manjanggul', '만장굴 (데모)')
on conflict (place_id) do nothing;

-- ───────────── 4) 보안: EXP 는 서버만 쓴다 ─────────────
-- 프로필: 사용자가 직접 바꿀 수 있는 컬럼만 열어둔다. (EXP / unspent_exp 는 막힘. INSERT 도 id 만 가능 → 기본값 0)
revoke update on public.jeju_profiles from authenticated, anon;
grant update (nickname, current_title, onboarding_completed) on public.jeju_profiles to authenticated;
revoke insert on public.jeju_profiles from authenticated, anon;
grant insert (id) on public.jeju_profiles to authenticated;

-- 퀘스트 진행(완료/건너뜀)은 서버 함수만 기록한다. (EXP 지급과 같은 경로)
drop policy if exists "jeju_quest_progress_insert_own" on public.jeju_quest_progress;
drop policy if exists "jeju_quest_progress_update_own" on public.jeju_quest_progress;

-- ───────────── 5) EXP / 발견 / 투자 DB 함수 ─────────────
-- 모든 EXP 변경은 이 함수들을 거친다. service_role(서버)만 실행할 수 있다.

-- p_parts: [{ "category": "explore" | ... | null(자유 EXP), "amount": 15 }, ...]
-- 반환: { awarded, before:{explore..discovery, unspent}, added:{...} }
--  - 이미 같은 source_key 로 지급됐다면 awarded=false 이고 아무것도 바뀌지 않는다.
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
  v_add jsonb := '{"explore":0,"culture":0,"food":0,"relax":0,"social":0,"discovery":0,"unspent":0}'::jsonb;
begin
  select * into v_profile from public.jeju_profiles where id = p_user for update;
  if not found then
    raise exception 'profile_not_found';
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

  return jsonb_build_object(
    'awarded', v_awarded,
    'before', jsonb_build_object(
      'explore', v_profile.exp_explore, 'culture', v_profile.exp_culture, 'food', v_profile.exp_food,
      'relax', v_profile.exp_relax, 'social', v_profile.exp_social, 'discovery', v_profile.exp_discovery,
      'unspent', v_profile.unspent_exp
    ),
    'added', v_add
  );
end;
$$;

-- 발견: place_discoveries 에 평생 최초 1회만 기록하고, 그때만 discovery EXP 를 지급한다. (한 트랜잭션)
create or replace function public.jeju_record_discovery(
  p_user uuid, p_place_id text, p_place_name text, p_type text, p_amount integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows integer;
  v_exp jsonb;
begin
  insert into public.jeju_place_discoveries (user_id, place_id, place_name, discovery_type)
  values (p_user, p_place_id, p_place_name, p_type)
  on conflict (user_id, place_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('discovered', false);
  end if;

  v_exp := public.jeju_apply_exp(
    p_user, 'discovery', p_place_id, 'discovery:' || p_place_id,
    jsonb_build_array(jsonb_build_object('category', 'discovery', 'amount', p_amount))
  );
  return v_exp || jsonb_build_object('discovered', true);
end;
$$;

-- 자유 EXP 투자: 자유 EXP "한 덩어리(지급 로그 1건)"를 카테고리 하나에 전부 투자한다. 분할/중복 투자 불가.
-- 일반 5개 카테고리에만 투자할 수 있다. (discovery 는 발견으로만 오른다)
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

  insert into public.jeju_exp_logs (user_id, category, amount, source_type, source_id, source_key)
  values (p_user, p_category, v_grant.amount, 'free_exp_invest', p_grant_id::text, 'invest:' || p_grant_id)
  on conflict (user_id, source_key, (coalesce(category, ''))) do nothing;
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

-- 일반 사용자(anon / authenticated)가 직접 호출하지 못하게 막는다.
revoke all on function public.jeju_apply_exp(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.jeju_record_discovery(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.jeju_invest_exp(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.jeju_apply_exp(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.jeju_record_discovery(uuid, text, text, text, integer) to service_role;
grant execute on function public.jeju_invest_exp(uuid, uuid, text) to service_role;
