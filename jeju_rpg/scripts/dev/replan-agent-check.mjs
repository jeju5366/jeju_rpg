// 개발용 도구: 실제 OpenAI 로 REPLAN Agent 프롬프트와 Surprise Agent 를 한 번씩 확인한다. (DB/로그인 없이 mock 장소 데이터 사용)
//   node --env-file=.env scripts/dev/replan-agent-check.mjs
import { askQuestAgent, validateQuests } from '../../api/_lib/agent/quests.js'
import { askSurpriseAgent } from '../../api/_lib/agent/surprise.js'
import { buildNearbyIndex } from '../../api/_lib/agent/walkability.js'
import { MOCK_PLACES } from '../../api/_lib/mock/places.js'

const place = (p) => ({ ...p, category: { 12: '관광지', 14: '문화시설', 39: '음식점', 38: '쇼핑' }[p.contentTypeId] ?? '기타', area: '제주시' })
const pool = MOCK_PLACES.filter((p) => p.contentTypeId !== 15).map(place)
const keep = pool.find((p) => p.placeId === 'demo-osulloc') // 이미 예고한 다음 챕터
const corePool = [keep, ...pool.filter((p) => ['demo-camellia', 'demo-hyeopjae', 'demo-saebyeol'].includes(p.placeId))]
const nearby = buildNearbyIndex(corePool, pool)
const context = { currentTime: '15:00', season: 'autumn', transport: 'rental_car', companion: 'friends', partySize: 2, desiredEndTime: '19:30', preferences: { explore: 70, culture: 60, food: 50, relax: 40, social: 60, discovery: 70 }, weather: { temperatureC: 17, sky: 'cloudy', precipitationType: 'rain' } }

console.log('=== REPLAN (keepOrder: 오설록 유지, 남은 시간 짧음) ===')
const input = { context, adventure: { title: '서쪽 하루', summary: '서귀포 서쪽 코스', data: {} }, corePool, extraPool: pool.filter((p) => !corePool.includes(p)), nearby, companion: 'friends', chapterRange: { min: 1, max: 3 }, replan: { reason: 'WEATHER_CHANGE', keepOrder: [keep.placeId], constraints: { minutesToEndOfDay: 270, weather: 'heavy_rain', indoorOnly: true, remainingOriginalChapters: 3, alreadyAnnouncedNextChapterPlaceId: keep.placeId } } }
try {
  const { quests, usages } = await askQuestAgent(input)
  console.log('검증 통과. 챕터:', quests.chapters.map((c) => `${c.title}(${c.corePlaceId})`).join(' → '), '| 첫 챕터가 예고 장소:', quests.chapters[0].corePlaceId === keep.placeId, '| tokens', usages.map((u) => `${u.inputTokens}/${u.outputTokens}`).join(','))
  for (const c of quests.chapters) {
    console.log(`  [${c.title}] 핵심: ${c.coreQuest.title} — ${c.coreQuest.description} (${c.coreQuest.verificationType})`)
    c.optionalQuests.forEach((q) => console.log(`     · ${q.title} — ${q.description} (${q.verificationType})`))
  }
  console.log('재검증 오류:', validateQuests(quests, input))
} catch (error) {
  console.log('REPLAN 실패:', error.message.slice(0, 300))
}

console.log('\n=== SURPRISE ===')
const nearbyPlaces = pool.filter((p) => ['demo-camellia', 'demo-osulloc', 'demo-hyeopjae'].includes(p.placeId)).map((p) => ({ placeId: p.placeId, name: p.name, category: p.category, distanceMeters: 300 }))
try {
  const result = await askSurpriseAgent({
    allowedPlaceIds: new Set(nearbyPlaces.map((p) => p.placeId)),
    companion: 'friends',
    prompt: { trigger: 'core_completed', context, remainingMinutes: 270, anchor: { placeId: 'demo-camellia', name: '카멜리아힐' }, nearby: nearbyPlaces },
  })
  console.log(JSON.stringify(result.output, null, 1), '| tokens', result.usages.map((u) => `${u.inputTokens}/${u.outputTokens}`).join(','))
} catch (error) {
  console.log('SURPRISE 실패:', error.message.slice(0, 300))
}
