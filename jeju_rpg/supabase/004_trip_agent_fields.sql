-- 4-1단계: Agent 가 쓸 여행/숙소 필드 추가 (001~003 실행 후 한 번 실행. 여러 번 실행해도 안전, 기존 데이터 유지)
--  * jeju_trips          : party_size, travel_range, desired_end_time, departure_datetime
--  * jeju_accommodations : address, latitude, longitude  (동선 계산용)
--  * jeju_save_trip_setup RPC 가 위 필드를 함께 저장하도록 교체
-- jeju_profiles.current_title 은 그대로 둔다 (EXP/칭호 단계에서 current_title_id + jeju_titles FK 로 변경 예정).

-- ───────────── jeju_trips ─────────────
alter table public.jeju_trips add column if not exists party_size integer not null default 1;
alter table public.jeju_trips add column if not exists travel_range text;          -- 여행 기본 이동 범위(선택). 모험별 값은 jeju_adventures.travel_range
alter table public.jeju_trips add column if not exists desired_end_time time;      -- 하루 마무리 희망 시각(선택)
alter table public.jeju_trips add column if not exists departure_datetime timestamptz; -- 제주 출발 일시(선택)

alter table public.jeju_trips drop constraint if exists jeju_trips_party_size_range;
alter table public.jeju_trips
  add constraint jeju_trips_party_size_range check (party_size between 1 and 50);

alter table public.jeju_trips drop constraint if exists jeju_trips_travel_range_check;
alter table public.jeju_trips
  add constraint jeju_trips_travel_range_check
  check (travel_range is null or travel_range in ('near','normal','anywhere'));

-- ───────────── jeju_accommodations ─────────────
alter table public.jeju_accommodations add column if not exists address text;
alter table public.jeju_accommodations add column if not exists latitude double precision;
alter table public.jeju_accommodations add column if not exists longitude double precision;

alter table public.jeju_accommodations drop constraint if exists jeju_accommodations_lat_range;
alter table public.jeju_accommodations
  add constraint jeju_accommodations_lat_range check (latitude is null or latitude between -90 and 90);

alter table public.jeju_accommodations drop constraint if exists jeju_accommodations_lng_range;
alter table public.jeju_accommodations
  add constraint jeju_accommodations_lng_range check (longitude is null or longitude between -180 and 180);

-- 위도/경도는 둘 다 있거나 둘 다 없어야 한다.
alter table public.jeju_accommodations drop constraint if exists jeju_accommodations_latlng_pair;
alter table public.jeju_accommodations
  add constraint jeju_accommodations_latlng_pair check ((latitude is null) = (longitude is null));

-- ───────────── 여행 설정 저장 RPC (새 필드 포함) ─────────────
-- trips + accommodations + onboarding_completed 를 한 트랜잭션으로 처리한다. security invoker 라 RLS 가 그대로 적용된다.
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

  insert into public.jeju_trips (
    user_id, start_date, end_date, companion, transport, arrival_flight, departure_flight,
    party_size, travel_range, desired_end_time, departure_datetime
  )
  values (
    v_user,
    (p_trip ->> 'start_date')::date,
    (p_trip ->> 'end_date')::date,
    p_trip ->> 'companion',
    p_trip ->> 'transport',
    nullif(btrim(p_trip ->> 'arrival_flight'), ''),
    nullif(btrim(p_trip ->> 'departure_flight'), ''),
    coalesce(nullif(p_trip ->> 'party_size', '')::integer, 1),
    nullif(p_trip ->> 'travel_range', ''),
    nullif(p_trip ->> 'desired_end_time', '')::time,
    nullif(p_trip ->> 'departure_datetime', '')::timestamptz
  )
  returning id into v_trip_id;

  insert into public.jeju_accommodations (trip_id, user_id, name, check_in, check_out, address, latitude, longitude)
  select
    v_trip_id, v_user, btrim(a ->> 'name'), (a ->> 'check_in')::date, (a ->> 'check_out')::date,
    nullif(btrim(a ->> 'address'), ''),
    nullif(a ->> 'latitude', '')::double precision,
    nullif(a ->> 'longitude', '')::double precision
  from jsonb_array_elements(p_accommodations) as a;

  update public.jeju_profiles set onboarding_completed = true where id = v_user;

  return v_trip_id;
end;
$$;

revoke all on function public.jeju_save_trip_setup(jsonb, jsonb) from public;
grant execute on function public.jeju_save_trip_setup(jsonb, jsonb) to authenticated;
