export class HttpError extends Error {
  // details: 오류 코드와 함께 화면에 돌려줄 부가 정보 (예: GPS 인증 실패 시 목표까지 거리). 응답 body 에 같이 실린다.
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

// 쿼리 문자열의 숫자 파라미터를 검증해서 읽는다.
export function numberParam(query, key, { min, max, fallback } = {}) {
  const raw = query[key]
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback
    throw new HttpError(400, `${key} is required`)
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new HttpError(400, `${key} is invalid`)
  }
  return value
}
// 쿼리 문자열 파라미터를 패턴으로 검증해서 읽는다. (외부 API 호출 값에 들어가므로 허용 문자를 제한)
export function stringParam(query, key, { pattern, fallback } = {}) {
  const raw = query[key]
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback
    throw new HttpError(400, `${key} is required`)
  }
  const value = String(raw)
  if (pattern && !pattern.test(value)) throw new HttpError(400, `${key} is invalid`)
  return value
}