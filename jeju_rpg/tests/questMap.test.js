import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { JEJU_AIRPORT } from '../src/constants/jeju.js'
import { useMapFocusStore } from '../src/store/mapFocusStore.js'
import {
  airportFocusTarget,
  chapterDestination,
  describeDistance,
  distanceSummary,
  formatDistance,
  initialPreviewOpen,
  mapFocusTarget,
  optionalHasOwnPlace,
  PREVIEW_HEIGHT_PX,
  togglePreview,
} from '../src/utils/questLocation.js'

const NOW = 1_800_000_000_000
const here = { lat: 33.4584, lng: 126.9425, accuracy: 20, timestamp: NOW - 30 * 1000 }
const core = { id: 'q1', quest_type: 'core', place_id: 'p-sunrise', place_name: '성산일출봉 전망대', place_lat: 33.4619, place_lng: 126.9427, title: '일출봉 오르기' }
const dest = chapterDestination([core])
const read = (file) => readFileSync(file, 'utf8')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

// ───────── 접이식 preview 상태 ─────────
test('지도 preview 는 기본 접힘, 지도 보기로 펼치고 다시 눌러 접을 수 있다', () => {
  let open = initialPreviewOpen()
  assert.equal(open, false)
  open = togglePreview(open)
  assert.equal(open, true)
  open = togglePreview(open)
  assert.equal(open, false)
})

test('접혀 있으면 지도 컴포넌트를 렌더하지 않는다 / 펼쳤을 때 높이는 180~220px', () => {
  const row = read('src/components/quest/QuestLocationRow.jsx')
  assert.match(row, /\{open && <QuestMapPreview/) // 접힘 = 지도 미생성
  assert.ok(PREVIEW_HEIGHT_PX >= 180 && PREVIEW_HEIGHT_PX <= 220)
  assert.match(read('src/components/quest/QuestMapPreview.jsx'), /height: PREVIEW_HEIGHT_PX/)
})

// ───────── 위치 / 거리 정보 ─────────
test('위치 요약: 최근 현재 위치 + 목적지로 거리/도보 시간을 코드가 계산한다', () => {
  const summary = distanceSummary({ position: here, destination: dest, transport: 'rental_car', now: NOW })
  assert.ok(summary.meters > 300 && summary.meters < 450)
  assert.equal(summary.mode, 'walk') // 가까우면 도보
  assert.ok(summary.minutes >= 3 && summary.minutes <= 12)
  assert.match(describeDistance(summary), /^약 \d+m · 도보 약 \d+분$/)
  assert.equal(formatDistance(420), '420m')
  assert.equal(formatDistance(2500), '2.5km')
})

test('위치 요약: 먼 거리는 이동수단 추정(예상 표시), 위치 없음/오래된 위치/좌표 없음이면 표시 안 함', () => {
  const far = distanceSummary({ position: { ...here, lat: 33.25, lng: 126.56 }, destination: dest, transport: 'rental_car', now: NOW })
  assert.equal(far.mode, 'car')
  assert.match(describeDistance(far), /차량 약 \d+분 \(예상\)$/)
  assert.equal(distanceSummary({ position: null, destination: dest, now: NOW }), null)
  assert.equal(distanceSummary({ position: { ...here, timestamp: NOW - 10 * 60 * 1000 }, destination: dest, now: NOW }), null) // 오래된 위치는 현재 위치가 아님
  assert.equal(distanceSummary({ position: here, destination: { name: '좌표 없음' }, now: NOW }), null)
})

test('현재 챕터 목적지: 핵심 퀘스트(좌표 있음, 교체되지 않음)만', () => {
  const dest = chapterDestination([{ id: 'o1', quest_type: 'optional', place_lat: 1, place_lng: 1 }, core])
  assert.deepEqual([dest.questId, dest.name, dest.lat], ['q1', '성산일출봉 전망대', 33.4619])
  assert.equal(chapterDestination([{ ...core, place_lat: null }]), null)
  assert.equal(chapterDestination([{ ...core, replaced_at: '2026-11-03T00:00:00Z' }]), null)
  assert.equal(chapterDestination([]), null)
})

// ───────── 선택 퀘스트 위치 ─────────
test('선택 퀘스트: 핵심과 같은 장소면 위치 UI 반복 없음, 다른 장소(좌표 있음)일 때만 지도 액션', () => {
  assert.equal(optionalHasOwnPlace({ ...core, id: 'o1', quest_type: 'optional' }, core), false) // 같은 place_id
  assert.equal(optionalHasOwnPlace({ id: 'o2', place_id: 'x', place_lat: 33.46191, place_lng: 126.94271 }, core), false) // 30m 이내 = 같은 장소
  assert.equal(optionalHasOwnPlace({ id: 'o3', place_id: 'y', place_lat: 33.47, place_lng: 126.95 }, core), true)
  assert.equal(optionalHasOwnPlace({ id: 'o4', place_id: 'z' }, core), false) // 좌표 없음
  // compact 카드에는 미니맵/위치 UI 가 없다 (펼친 QuestCard 에서만 onViewMap)
  assert.doesNotMatch(read('src/components/quest/CompactQuestRow.jsx'), /Map|지도/)
})

// ───────── 지도 탭 포커스 ─────────
test('지도에서 보기: quest/place/좌표를 담은 일회용 포커스 대상, 지도 탭이 한 번 읽고 비운다', () => {
  const target = mapFocusTarget({ quest: { ...core, quest_type: 'optional' }, now: 7 })
  assert.deepEqual(target, { lat: 33.4619, lng: 126.9427, title: '성산일출봉 전망대', questId: 'q1', placeId: 'p-sunrise', key: 7 })
  assert.deepEqual(mapFocusTarget({ destination: { questId: 'q1', placeId: 'p', name: 'A', lat: 1, lng: 2 }, now: 1 }).title, 'A')
  assert.equal(mapFocusTarget({ quest: { id: 'q', title: '좌표 없음' } }), null)

  useMapFocusStore.getState().setTarget(target)
  assert.equal(useMapFocusStore.getState().consume().questId, 'q1')
  assert.equal(useMapFocusStore.getState().consume(), null) // 두 번째 진입(일반 지도 탭)은 포커스 없음
  assert.equal(useMapFocusStore.getState().target, null)
})

test('일반 지도 탭 진입은 기존 동작: 포커스 없으면 focus=null, 처음 전체 맞춤 유지. 포커스가 있으면 전체 맞춤이 덮어쓰지 않는다', () => {
  const page = read('src/pages/MapPage.jsx')
  assert.match(page, /useState\(\(\) => \(pin \? \{ lat: pin\.lat/) // pin 없으면 null
  assert.match(page, /pin \? \[\{ id: 'target'/) // 포커스 마커는 pin 이 있을 때만 추가
  const view = read('src/components/map/NaverMapView.jsx')
  assert.match(view, /!host\.fitted && !focus/)
  assert.match(view, /host\.fitted = true/)
  assert.ok(read('src/pages/MapPage.jsx').includes('FreeTravelPanel')) // 기존 지도 기능 유지
})

test('Final Quest: 공항 지도에서 보기 → 제주국제공항 포커스', () => {
  const target = airportFocusTarget(5)
  assert.deepEqual([target.lat, target.lng, target.title], [JEJU_AIRPORT.lat, JEJU_AIRPORT.lng, '제주국제공항'])
  const panel = read('src/components/finalQuest/FinalQuestPanel.jsx')
  assert.match(panel, /airportFocusTarget\(\)/)
  assert.match(panel, /airportMapButton/)
})

// ───────── NAVER SDK / 레이아웃 ─────────
test('NAVER SDK 스크립트는 mapLoader 한 곳에서만 만든다 (preview 가 중복 로드하지 않는다)', () => {
  const creators = walk('src').filter((file) => /createElement\(['"]script['"]\)/.test(read(file)))
  assert.deepEqual(creators.map((f) => f.replaceAll('\\', '/')), ['src/services/naver/mapLoader.js'])
  assert.match(read('src/components/quest/QuestMapPreview.jsx'), /loadNaverMaps/)
  assert.doesNotMatch(read('src/components/quest/QuestMapPreview.jsx'), /oapi\.map\.naver/)
})

test('모바일 레이아웃: 위치 row 는 일반 흐름(고정 위치 아님)이라 하단 sticky 챕터 버튼/bottom nav 와 겹치지 않는다', () => {
  const css = read('src/styles/global.css')
  const block = css.match(/\.quest-location \{[\s\S]*?\.quest-map-preview \{[^}]*\}/)[0]
  assert.doesNotMatch(block, /position:\s*fixed|position:\s*sticky/)
  assert.match(css, /\.chapter-action-bar\s*\{[^}]*position:\s*fixed/) // 기존 sticky 액션바는 그대로
  // 위치 row 는 챕터 요약 바로 아래 1줄이고, 지도는 펼쳤을 때만 높이를 쓴다
  const chapter = read('src/components/quest/ChapterSection.jsx')
  assert.ok(chapter.indexOf('{location}') < chapter.indexOf('{/* 핵심 퀘스트'))
})
