-- 10단계: 사진 인증 + 추억 사진 (008 실행 후 한 번 실행. 여러 번 실행해도 안전)
-- additive migration: 기존 컬럼/데이터/정책은 바꾸지 않는다. (travel_photos 의 클라이언트 쓰기 정책 2개만 보안을 위해 제거)
--
-- 원칙
--  * 인증용 사진은 "임시"다. 서버가 AI 분석에만 쓰고 저장하지 않는다. (Storage 에 올리지 않으므로 지울 것도 없다)
--  * 사용자가 "추억으로 남기기"를 고른 사진만 Storage(travel-memories)에 영구 저장하고 travel_photos 에 기록한다.
--  * 추억 저장/삭제 경로는 서버(service_role)만 쓴다. 클라이언트는 자기 폴더의 사진을 "읽기"(signed URL)만 한다.

-- ───────────── 퀘스트 진행: 사진 인증 상태 ─────────────
-- gps_photo 처럼 두 단계가 모두 필요한 퀘스트의 중간 상태를 남긴다. (status 는 in_progress 그대로, 둘 다 채워져야 completed)
--   gps_verified_at   : GPS 인증 성공 시각
--   photo_verified_at : 사진 인증 성공 시각 (AI pass 또는 upload_only 업로드)
--   photo_attempts    : 사진 AI 판정 횟수 (003 의 컬럼, 최대 2). 판정(pass/uncertain/fail)을 받은 횟수만 센다.
--   photo_errors      : 사진 AI 호출이 장애/시간 초과/형식 오류로 실패한 횟수. 2번 실패하면 AI 사진 인증을 닫고 직접 확인으로 안내한다.
--   photo_last        : 마지막 시도 { attemptId, status(pending|done), result, reason, mode } — 같은 attemptId 재전송은 AI 를 다시 부르지 않고 이 값을 돌려준다.
alter table public.jeju_quest_progress add column if not exists gps_verified_at timestamptz;
alter table public.jeju_quest_progress add column if not exists photo_verified_at timestamptz;
alter table public.jeju_quest_progress add column if not exists photo_errors smallint not null default 0;
alter table public.jeju_quest_progress add column if not exists photo_last jsonb;

alter table public.jeju_quest_progress drop constraint if exists jeju_quest_progress_photo_errors_range;
alter table public.jeju_quest_progress
  add constraint jeju_quest_progress_photo_errors_range check (photo_errors between 0 and 5);

-- ───────────── 추억 사진 (travel_photos, 003 에서 만든 테이블 확장) ─────────────
-- 행이 있다 = 사용자가 추억으로 저장한 사진. (인증만 한 사진은 행도 파일도 남기지 않는다)
alter table public.jeju_travel_photos add column if not exists adventure_id uuid references public.jeju_adventures (id) on delete set null;
alter table public.jeju_travel_photos add column if not exists place_id text;
alter table public.jeju_travel_photos add column if not exists caption text;
alter table public.jeju_travel_photos add column if not exists latitude double precision;  -- 추후 연결용 (지금은 비워 둔다)
alter table public.jeju_travel_photos add column if not exists longitude double precision;
alter table public.jeju_travel_photos add column if not exists content_type text;
alter table public.jeju_travel_photos add column if not exists size_bytes integer;

alter table public.jeju_travel_photos drop constraint if exists jeju_travel_photos_caption_len;
alter table public.jeju_travel_photos
  add constraint jeju_travel_photos_caption_len check (caption is null or char_length(caption) <= 200);

-- 퀘스트 하나당 추억 사진은 1장. 같은 사진을 여러 번 저장해도 중복 행이 생기지 않는다.
create unique index if not exists jeju_travel_photos_memory_quest_uidx
  on public.jeju_travel_photos (user_id, quest_id) where is_memory and quest_id is not null;
create unique index if not exists jeju_travel_photos_storage_path_uidx
  on public.jeju_travel_photos (storage_path) where storage_path is not null;
-- 기록 화면 / 12단계 여행 요약에서 여행별로 시간순 조회
create index if not exists jeju_travel_photos_trip_idx on public.jeju_travel_photos (user_id, trip_id, created_at desc) where is_memory;

-- 클라이언트가 임의의 storage_path 로 행을 만들거나 바꾸지 못하게 한다. (저장은 서버 API 만, 조회/삭제는 본인 행만)
drop policy if exists "jeju_travel_photos_insert_own" on public.jeju_travel_photos;
drop policy if exists "jeju_travel_photos_update_own" on public.jeju_travel_photos;

-- ───────────── API 사용 로그: 사진 인증 구분 ─────────────
-- 사진 인증은 Agent 요청(jeju_agent_requests, request_type 5종)과 섞지 않는다. 사용량 로그에 purpose 로만 구분한다.
alter table public.jeju_api_usage_logs add column if not exists purpose text not null default 'agent';
alter table public.jeju_api_usage_logs add column if not exists quest_id uuid references public.jeju_quests (id) on delete set null;
alter table public.jeju_api_usage_logs add column if not exists result text; -- 사진 인증: pass | uncertain | fail

-- ───────────── Storage: 추억 사진 bucket ─────────────
-- private bucket. 경로: {user_id}/{trip_id}/{uuid}.jpg  (첫 폴더 = 사용자 id 로 본인 확인)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('travel-memories', 'travel-memories', false, 5242880, array['image/jpeg', 'image/webp', 'image/png'])
    on conflict (id) do update
      set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png'];

    -- 본인 폴더만 읽기/삭제. 업로드(insert/update)는 정책을 만들지 않는다 → 클라이언트는 올릴 수 없고 서버(service_role)만 올린다.
    drop policy if exists "travel_memories_select_own" on storage.objects;
    create policy "travel_memories_select_own" on storage.objects
      for select to authenticated
      using (bucket_id = 'travel-memories' and (storage.foldername(name))[1] = auth.uid()::text);

    drop policy if exists "travel_memories_delete_own" on storage.objects;
    create policy "travel_memories_delete_own" on storage.objects
      for delete to authenticated
      using (bucket_id = 'travel-memories' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
