-- 3단계 시작 전 DB 수정 (001 실행 후 한 번 실행. 여러 번 실행해도 안전)
--  1) 닉네임: jeju_characters.nickname -> jeju_profiles.nickname 으로 이동
--  2) meal_preference / dessert_preference: text -> integer(0~100)

-- ───────────── 1) nickname ─────────────
alter table public.jeju_profiles add column if not exists nickname text;

-- 기존 테스트 데이터 이전: characters 에 닉네임이 있고 profiles 에는 아직 없는 경우만 복사
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jeju_characters' and column_name = 'nickname'
  ) then
    update public.jeju_profiles p
       set nickname = c.nickname
      from public.jeju_characters c
     where c.user_id = p.id
       and p.nickname is null;

    alter table public.jeju_characters drop column nickname;
  end if;
end $$;

alter table public.jeju_profiles drop constraint if exists jeju_profiles_nickname_len;
alter table public.jeju_profiles
  add constraint jeju_profiles_nickname_len
  check (nickname is null or char_length(nickname) between 1 and 20);

-- ───────────── 2) meal / dessert 점수화 ─────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jeju_travel_preferences'
      and column_name = 'meal_preference' and data_type = 'text'
  ) then
    -- 숫자 문자열만 0~100 으로 보정해 변환하고, 그 외 값(예: 'korean')은 null 로 둔다.
    alter table public.jeju_travel_preferences
      alter column meal_preference type integer
      using (case when meal_preference ~ '^\d+$' then least(meal_preference::numeric, 100)::integer end);
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jeju_travel_preferences'
      and column_name = 'dessert_preference' and data_type = 'text'
  ) then
    alter table public.jeju_travel_preferences
      alter column dessert_preference type integer
      using (case when dessert_preference ~ '^\d+$' then least(dessert_preference::numeric, 100)::integer end);
  end if;
end $$;

alter table public.jeju_travel_preferences drop constraint if exists jeju_travel_preferences_meal_range;
alter table public.jeju_travel_preferences drop constraint if exists jeju_travel_preferences_dessert_range;
alter table public.jeju_travel_preferences
  add constraint jeju_travel_preferences_meal_range
  check (meal_preference is null or meal_preference between 0 and 100);
alter table public.jeju_travel_preferences
  add constraint jeju_travel_preferences_dessert_range
  check (dessert_preference is null or dessert_preference between 0 and 100);
