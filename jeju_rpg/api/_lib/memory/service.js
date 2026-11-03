import { randomUUID } from 'node:crypto'
import { MEMORY_BUCKET, MEMORY_CAPTION_MAX_CHARS } from '../../../src/constants/photoRules.js'
import { HttpError } from '../http.js'
import { decodeImage } from '../photo/image.js'
import { PHOTO_TYPES } from '../photo/mode.js'
import { getAdmin } from '../supabaseAdmin.js'

// 추억 사진 저장. "인증용 사진"과 "추억 사진"은 다르다.
//   · 인증용 사진은 임시: 사진 인증 API 가 메모리에서만 쓰고 버린다. (저장 안 함)
//   · 사용자가 "추억으로 남기기"를 눌렀을 때만 이 함수로 Supabase Storage(travel-memories) 에 영구 저장하고 travel_photos 에 기록한다.
//   · 사진 인증으로 완료한 퀘스트(photo_upload / photo_ai / gps_photo)만, 퀘스트당 1장. 같은 사진을 여러 번 눌러도 중복 저장되지 않는다.
//   · 추억 저장은 퀘스트 완료와 무관하다. 저장하지 않아도 퀘스트는 완료 상태 그대로다.
// 경로: {userId}/{tripId}/{uuid}.{jpg|png|webp}  — 첫 폴더가 사용자 id 라서 Storage RLS 가 본인 것만 읽게 한다.
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_METHODS = PHOTO_TYPES // verification_method 로 기록되는 사진 포함 방식

async function maybe(query) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function saveMemoryPhoto({ user, questId, image, caption, db = getAdmin() }) {
  const userId = user.id
  const decoded = decodeImage(image)
  const cleanCaption = String(caption ?? '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_CAPTION_MAX_CHARS) || null

  const quest = await maybe(db.from('jeju_quests').select('*').eq('id', questId).eq('user_id', userId))
  if (!quest) throw new HttpError(404, 'quest_not_found')
  const progress = await maybe(db.from('jeju_quest_progress').select('*').eq('user_id', userId).eq('quest_id', questId))
  if (progress?.status !== 'completed' || !PHOTO_METHODS.includes(progress.verification_method)) throw new HttpError(409, 'memory_not_available')

  const already = await maybe(db.from('jeju_travel_photos').select('*').eq('user_id', userId).eq('quest_id', questId).eq('is_memory', true))
  if (already) return { saved: true, alreadySaved: true, photo: already }

  const adventure = await maybe(db.from('jeju_adventures').select('id, trip_id').eq('id', quest.adventure_id).eq('user_id', userId))
  if (!adventure) throw new HttpError(404, 'adventure_not_found')

  const path = `${userId}/${adventure.trip_id}/${randomUUID()}.${EXTENSION[decoded.mime]}`
  const { error: uploadError } = await db.storage.from(MEMORY_BUCKET).upload(path, decoded.buffer, { contentType: decoded.mime, upsert: false })
  if (uploadError) throw new HttpError(502, 'memory_upload_failed')

  const { data: photo, error } = await db
    .from('jeju_travel_photos')
    .insert({
      user_id: userId,
      trip_id: adventure.trip_id,
      adventure_id: adventure.id,
      quest_id: quest.id,
      place_id: quest.place_id,
      is_memory: true,
      storage_path: path,
      caption: cleanCaption,
      content_type: decoded.mime,
      size_bytes: decoded.buffer.length,
      verification_result: progress.photo_last?.result ?? null,
      verification_reason: progress.photo_last?.reason ?? null,
    })
    .select('*')
    .single()
  if (error) {
    // 동시에 두 번 눌렀다면 한쪽만 남긴다: 방금 올린 파일은 지우고 먼저 저장된 사진을 돌려준다.
    await db.storage.from(MEMORY_BUCKET).remove([path]).catch(() => {})
    if (error.code === '23505') {
      const first = await maybe(db.from('jeju_travel_photos').select('*').eq('user_id', userId).eq('quest_id', questId).eq('is_memory', true))
      if (first) return { saved: true, alreadySaved: true, photo: first }
    }
    throw error
  }
  return { saved: true, alreadySaved: false, photo }
}
