-- 2단계: profiles / characters / travel_preferences
-- Supabase 대시보드 > SQL Editor 에서 한 번 실행한다. (여러 번 실행해도 안전)
-- (이후 변경은 002_nickname_and_preference_scores.sql 참고: nickname 이동, meal/dessert 점수화)
-- 다른 프로젝트 테이블과 겹치지 않도록 jeju_ 접두사를 쓴다.
-- 레벨 컬럼은 저장하지 않는다(EXP로 계산). total_exp 도 따로 저장하지 않는다(6개 EXP 합).

-- ───────────── jeju_profiles ─────────────
create table if not exists public.jeju_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  exp_explore   integer not null default 0 check (exp_explore   >= 0),
  exp_culture   integer not null default 0 check (exp_culture   >= 0),
  exp_food      integer not null default 0 check (exp_food      >= 0),
  exp_relax     integer not null default 0 check (exp_relax     >= 0),
  exp_social    integer not null default 0 check (exp_social    >= 0),
  exp_discovery integer not null default 0 check (exp_discovery >= 0),
  unspent_exp   integer not null default 0 check (unspent_exp   >= 0),
  current_title text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── jeju_characters ─────────────
create table if not exists public.jeju_characters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  body_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── jeju_travel_preferences ─────────────
-- 6축 0~100 정규화 + meal/dessert 별도 저장
create table if not exists public.jeju_travel_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  explore   integer not null check (explore   between 0 and 100),
  culture   integer not null check (culture   between 0 and 100),
  food      integer not null check (food      between 0 and 100),
  relax     integer not null check (relax     between 0 and 100),
  social    integer not null check (social    between 0 and 100),
  discovery integer not null check (discovery between 0 and 100),
  meal_preference text,
  dessert_preference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── updated_at 자동 갱신 ─────────────
create or replace function public.jeju_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists jeju_profiles_updated_at on public.jeju_profiles;
create trigger jeju_profiles_updated_at before update on public.jeju_profiles
  for each row execute function public.jeju_set_updated_at();

drop trigger if exists jeju_characters_updated_at on public.jeju_characters;
create trigger jeju_characters_updated_at before update on public.jeju_characters
  for each row execute function public.jeju_set_updated_at();

drop trigger if exists jeju_travel_preferences_updated_at on public.jeju_travel_preferences;
create trigger jeju_travel_preferences_updated_at before update on public.jeju_travel_preferences
  for each row execute function public.jeju_set_updated_at();

-- ───────────── RLS: auth.uid() 기준 본인 데이터만 ─────────────
alter table public.jeju_profiles           enable row level security;
alter table public.jeju_characters         enable row level security;
alter table public.jeju_travel_preferences enable row level security;

drop policy if exists "jeju_profiles_select_own" on public.jeju_profiles;
drop policy if exists "jeju_profiles_insert_own" on public.jeju_profiles;
drop policy if exists "jeju_profiles_update_own" on public.jeju_profiles;
create policy "jeju_profiles_select_own" on public.jeju_profiles
  for select using (auth.uid() = id);
create policy "jeju_profiles_insert_own" on public.jeju_profiles
  for insert with check (auth.uid() = id);
create policy "jeju_profiles_update_own" on public.jeju_profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "jeju_characters_select_own" on public.jeju_characters;
drop policy if exists "jeju_characters_insert_own" on public.jeju_characters;
drop policy if exists "jeju_characters_update_own" on public.jeju_characters;
create policy "jeju_characters_select_own" on public.jeju_characters
  for select using (auth.uid() = user_id);
create policy "jeju_characters_insert_own" on public.jeju_characters
  for insert with check (auth.uid() = user_id);
create policy "jeju_characters_update_own" on public.jeju_characters
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "jeju_travel_preferences_select_own" on public.jeju_travel_preferences;
drop policy if exists "jeju_travel_preferences_insert_own" on public.jeju_travel_preferences;
drop policy if exists "jeju_travel_preferences_update_own" on public.jeju_travel_preferences;
create policy "jeju_travel_preferences_select_own" on public.jeju_travel_preferences
  for select using (auth.uid() = user_id);
create policy "jeju_travel_preferences_insert_own" on public.jeju_travel_preferences
  for insert with check (auth.uid() = user_id);
create policy "jeju_travel_preferences_update_own" on public.jeju_travel_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
