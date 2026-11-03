import { UI_TEXT } from './uiText.js'

// 하단 네비 5개: 홈/지도/퀘스트/기록/모험가
export const NAV_ITEMS = [
  { path: '/', label: UI_TEXT.nav.home },
  { path: '/map', label: UI_TEXT.nav.map },
  { path: '/quest', label: UI_TEXT.nav.quest },
  { path: '/records', label: UI_TEXT.nav.records },
  { path: '/profile', label: UI_TEXT.nav.profile },
]

// 온보딩/인증 Route는 하단 네비를 숨긴다.
export const HIDE_NAV_ROUTES = ['/auth', '/character', '/style-test', '/setup']
