-- 7단계 보강: 퀘스트 복합 카테고리 (004 실행 후 한 번 실행. 여러 번 실행해도 안전, 기존 데이터 유지)
--  * jeju_quests.category (단일) → category_primary + category_secondary(nullable). 퀘스트 하나당 최대 2개.
--  * 일반 퀘스트 EXP 카테고리는 explore / culture / food / relax / social 5개만 허용한다.
--    discovery EXP 는 8단계부터 jeju_place_discoveries(평생 최초 방문)로만 지급하므로 퀘스트 카테고리에서 제외한다.
--  * 이미 저장된 퀘스트는 category 값을 category_primary 로 옮긴다. (discovery 였던 값은 explore 로 보정)
--  * jeju_exp_logs.category / jeju_profiles.exp_discovery 는 발견 EXP 용이라 그대로 둔다.

alter table public.jeju_quests add column if not exists category_primary text;
alter table public.jeju_quests add column if not exists category_secondary text;

-- 기존 단일 category 이전 후 제거
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jeju_quests' and column_name = 'category'
  ) then
    update public.jeju_quests
       set category_primary = case when category = 'discovery' then 'explore' else category end
     where category_primary is null and category is not null;

    alter table public.jeju_quests drop column category;
  end if;
end $$;

alter table public.jeju_quests drop constraint if exists jeju_quests_category_primary_check;
alter table public.jeju_quests
  add constraint jeju_quests_category_primary_check
  check (category_primary is null or category_primary in ('explore','culture','food','relax','social'));

alter table public.jeju_quests drop constraint if exists jeju_quests_category_secondary_check;
alter table public.jeju_quests
  add constraint jeju_quests_category_secondary_check
  check (category_secondary is null or category_secondary in ('explore','culture','food','relax','social'));

-- secondary 는 primary 가 있을 때만, 그리고 primary 와 달라야 한다.
alter table public.jeju_quests drop constraint if exists jeju_quests_category_pair_check;
alter table public.jeju_quests
  add constraint jeju_quests_category_pair_check
  check (category_secondary is null or (category_primary is not null and category_secondary <> category_primary));
