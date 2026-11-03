import { requireUser } from './auth.js'
import { HttpError } from './http.js'

// 모든 /api/* 함수의 공통 틀: 메서드 확인 + 로그인 확인 + 에러 처리.
// run(query, user, body) — 기본은 GET, POST 가 필요하면 { method: 'POST' }.
export function createHandler(run, { method = 'GET' } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== method) return res.status(405).json({ error: 'method_not_allowed' })

    const user = await requireUser(req)
    if (!user) return res.status(401).json({ error: 'unauthorized' })

    try {
      return res.status(200).json(await run(req.query, user, req.body ?? {}))
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ ...error.details, error: error.message })
      console.error('[api] 처리 실패', error)
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}