// Vercel Hobby 플랜은 배포당 Serverless Function 을 12개까지만 허용한다. /api/<이름> 25개를 각각 함수로 두지 않고,
// 이 파일 하나(= 함수 1개)가 이름으로 실제 핸들러(api/_handlers/*.js)를 골라 실행한다. (경로/요청/응답은 그대로: /api/<이름>)
// 새 API 를 추가하면 api/_handlers/<이름>.js 를 만들고 아래 목록에 한 줄을 더하면 된다.
import adventuresGenerate from './_handlers/adventures-generate.js'
import adventuresReplan from './_handlers/adventures-replan.js'
import adventuresSelect from './_handlers/adventures-select.js'
import airportCongestion from './_handlers/airport-congestion.js'
import airportFlights from './_handlers/airport-flights.js'
import chaptersAdvance from './_handlers/chapters-advance.js'
import directions from './_handlers/directions.js'
import expInvest from './_handlers/exp-invest.js'
import finalQuest from './_handlers/final-quest.js'
import freeTravelFinish from './_handlers/free-travel-finish.js'
import freeTravelStart from './_handlers/free-travel-start.js'
import memoriesSave from './_handlers/memories-save.js'
import places from './_handlers/places.js'
import questsComplete from './_handlers/quests-complete.js'
import questsGenerate from './_handlers/quests-generate.js'
import questsPhotoVerify from './_handlers/quests-photo-verify.js'
import questsReveal from './_handlers/quests-reveal.js'
import surpriseEvaluate from './_handlers/surprise-evaluate.js'
import surpriseRespond from './_handlers/surprise-respond.js'
import transitArrivals from './_handlers/transit-arrivals.js'
import transitRoutes from './_handlers/transit-routes.js'
import transitStops from './_handlers/transit-stops.js'
import tripFeedback from './_handlers/trip-feedback.js'
import tripRecords from './_handlers/trip-records.js'
import weather from './_handlers/weather.js'

const HANDLERS = {
  'adventures-generate': adventuresGenerate,
  'adventures-replan': adventuresReplan,
  'adventures-select': adventuresSelect,
  'airport-congestion': airportCongestion,
  'airport-flights': airportFlights,
  'chapters-advance': chaptersAdvance,
  'directions': directions,
  'exp-invest': expInvest,
  'final-quest': finalQuest,
  'free-travel-finish': freeTravelFinish,
  'free-travel-start': freeTravelStart,
  'memories-save': memoriesSave,
  'places': places,
  'quests-complete': questsComplete,
  'quests-generate': questsGenerate,
  'quests-photo-verify': questsPhotoVerify,
  'quests-reveal': questsReveal,
  'surprise-evaluate': surpriseEvaluate,
  'surprise-respond': surpriseRespond,
  'transit-arrivals': transitArrivals,
  'transit-routes': transitRoutes,
  'transit-stops': transitStops,
  'trip-feedback': tripFeedback,
  'trip-records': tripRecords,
  'weather': weather,
}

// 일부 핸들러(모험/퀘스트 생성, 사진 인증 등)는 AI 호출 때문에 오래 걸린다.
export const config = { maxDuration: 60 }

export default function handler(req, res) {
  const name = String(req.query?.name ?? "")
  const run = Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : null
  if (!run) return res.status(404).json({ error: "not_found" })
  return run(req, res)
}
