// GENERATE_QUESTS 와 REPLAN 이 같은 모양으로 퀘스트 행을 만든다. (DB 컬럼 매핑은 이 한 곳)
// 장소 퀘스트는 장소 이름을 인증 대상으로, 좌표는 GPS 인증의 목표로 서버가 채운다. (GPT 가 정하지 못하게)
export function buildQuestRow({ base, quest, chapter, type, seq, hidden, placeById, source }) {
  const place = quest.placeId ? placeById.get(quest.placeId) : null
  return {
    ...base,
    chapter_id: chapter?.id ?? null,
    quest_type: type,
    title: quest.title.trim(),
    description: quest.description.trim(),
    difficulty: quest.difficulty,
    // 퀘스트 하나당 카테고리 최대 2개. discovery 는 퀘스트 카테고리가 아니다.
    category_primary: quest.categoryPrimary ?? null,
    category_secondary: quest.categorySecondary ?? null,
    // 의도한 인증 방식(verification_type)은 그대로 저장한다. 실제 완료 방식은 quest_progress.verification_method 에 기록된다.
    verification_type: quest.verificationType,
    verification_target: place && quest.verificationType !== 'self' ? place.name : null,
    place_id: place?.placeId ?? null,
    place_name: place?.name ?? null,
    // GPS 인증의 목표 좌표. TourAPI 후보의 값을 그대로 복사한다. (008 migration)
    place_lat: Number.isFinite(place?.lat) ? place.lat : null,
    place_lng: Number.isFinite(place?.lng) ? place.lng : null,
    time_limit_minutes: quest.timeLimitMinutes ?? null,
    is_hidden: hidden,
    seq,
    data: { source },
  }
}
