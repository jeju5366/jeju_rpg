-- 11단계: REPLAN + 돌발 퀘스트 + 일정 시간 기록 (009 실행 후 한 번 실행. 여러 번 실행해도 안전)
-- additive migration: 기존 컬럼/데이터/정책은 바꾸지 않는다. (chapters.status 허용값에 'replaced' 하나를 추가한다)
--
-- 원칙
--  * REPLAN 이 바꾸는 것은 "아직 끝나지 않은 남은 일정"뿐이다. 완료한 챕터/퀘스트, EXP, 방문/발견, 추억 사진, 칭호는 건드리지 않는다.
--  * 교체되는 미완료 일정은 삭제하지 않고 표시만 한다. (chapters.status='replaced' / quests.replaced_at) 화면은 이 표시가 있는 것을 숨긴다.
--  * REPLAN / 돌발 퀘스트 요청은 기존 jeju_agent_requests(request_key UNIQUE, 요청 유형 REPLAN_ADVENTURE / GENERATE_SURPRISE_QUEST)와
--    jeju_api_usage_logs 를 그대로 쓴다. (새 테이블 없음)

-- ───────────── 챕터: 열린/닫힌 시각 + 교체 상태 ─────────
-- 일정 지연/앞당김은 챕터를 연 시각(activated_at)과 닫은 시각(closed_at)을 예상 소요 시간과 비교해서 판단한다.
alter table public.jeju_chapters add column if not exists activated_at timestamptz;
alter table public.jeju_chapters add column if not exists closed_at timestamptz;
-- 이미 active 인 챕터/닫힌 챕터에는 가장 가까운 기존 시각을 채워 둔다. (이후부터는 서버가 정확한 시각을 기록한다)
update public.jeju_chapters set activated_at = created_at where activated_at is null and status in ('active', 'core_completed', 'completed', 'skipped');
update public.jeju_chapters set closed_at = updated_at where closed_at is null and status in ('completed', 'skipped');

alter table public.jeju_chapters drop constraint if exists jeju_chapters_status_check;
alter table public.jeju_chapters
  add constraint jeju_chapters_status_check
  check (status in ('locked','available','active','core_completed','completed','skipped','replaced'));

-- ───────────── 퀘스트: 교체 표시 + 돌발 퀘스트 상태 ─────────
-- replaced_at : REPLAN 으로 교체된 미완료 퀘스트. 삭제하지 않고 숨긴다.
-- surprise_status : 돌발 퀘스트(quest_type='surprise')만 사용. offered(제안됨) → accepted(도전) / declined(이번엔 지나가기)
--   declined 는 실패가 아니다. EXP 감점/선호도 불이익 없음.
alter table public.jeju_quests add column if not exists replaced_at timestamptz;
alter table public.jeju_quests add column if not exists surprise_status text;
alter table public.jeju_quests add column if not exists offered_at timestamptz;

alter table public.jeju_quests drop constraint if exists jeju_quests_surprise_status_check;
alter table public.jeju_quests
  add constraint jeju_quests_surprise_status_check
  check (surprise_status is null or surprise_status in ('offered','accepted','declined'));

create index if not exists jeju_quests_surprise_idx on public.jeju_quests (adventure_id, offered_at) where quest_type = 'surprise';
