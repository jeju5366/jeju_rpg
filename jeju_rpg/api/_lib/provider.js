import { getMode } from './env.js'

// 응답 형태: { source: 'live' | 'mock', fetchedAt, data, fallback?, error? }
//  - DATA_MODE=live + 키가 있으면 live() 호출. 실패하면 mock 으로 대체하고 fallback/error 를 표시한다.
//  - live 구현이 없는 제공자는 live 를 생략한다 (live 모드에서도 mock + fallback 으로 표시).
export async function runProvider({ live, mock }) {
  const fetchedAt = new Date().toISOString()

  if (getMode() === 'live') {
    if (!live) {
      return { source: 'mock', fallback: true, error: 'live provider not implemented', fetchedAt, data: await mock() }
    }
    try {
      return { source: 'live', fetchedAt, data: await live() }
    } catch (error) {
      console.error('[provider] live 호출 실패, mock 으로 대체', error)
      return { source: 'mock', fallback: true, error: error.message, fetchedAt, data: await mock() }
    }
  }

  return { source: 'mock', fetchedAt, data: await mock() }
}