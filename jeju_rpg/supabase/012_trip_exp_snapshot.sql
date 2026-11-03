-- 12단계 후속: 여행 상세 기록의 카테고리별 레벨 변화가 시간이 지나도 변하지 않게, 마무리 때 EXP 스냅샷을 최소한으로 저장한다.
--   exp_snapshot = { before: {explore..discovery}, after: {...} }  (카테고리 6개 숫자 두 묶음뿐. 레벨은 저장하지 않고 level curve 로 계산한다)
-- 스냅샷이 없는 기존 여행은 exp_logs 의 시각으로 종료 시점을 복원한다. (api/_lib/finalQuest/record.js resolveExpRange)
alter table public.jeju_trips add column if not exists exp_snapshot jsonb;
