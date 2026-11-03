// 공공데이터포털 GET 호출 공통 함수 (api_test 에서 동작 확인한 방식).
// 오류 메시지/로그에는 인증키를 절대 넣지 않는다.

function xmlErrorMessage(text) {
  const tag = (name) => text.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]
  return (
    tag('returnAuthMsg') ||
    tag('errMsg') ||
    tag('resultMsg') ||
    tag('message') ||
    text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  )
}

// 공공데이터포털은 오류를 XML 로 내려주는 경우가 많다. resultCode 가 정상(00/0000)이 아니면 Error.
// NODATA(03)는 빈 결과로 취급한다. 반환값은 json.response (없으면 json 전체).
export async function fetchPublicData(url, params) {
  const target = new URL(url)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, String(value))
  }

  let response
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(12000) })
  } catch (error) {
    throw new Error(`외부 API 호출 실패: ${error.name === 'TimeoutError' ? '시간 초과' : error.message}`)
  }

  const text = (await response.text()).trim()
  if (text.startsWith('<')) throw new Error(`외부 API 오류: ${xmlErrorMessage(text)}`)

  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`JSON 이 아닌 응답: ${text.slice(0, 160)}`)
  }

  // 게이트웨이 레벨 오류 (예: 허용 범위를 넘는 numOfRows -> HTTP_ERROR)
  const gateway = json?.OpenAPI_ServiceResponse?.cmmMsgHeader
  if (gateway) {
    throw new Error(`외부 API 오류(${gateway.returnReasonCode ?? '?'}): ${gateway.returnAuthMsg ?? gateway.errMsg ?? '알 수 없음'}`)
  }

  const header = json?.response?.header ?? json?.header
  const code = header?.resultCode
  if (code !== undefined && !['00', '0000', '0'].includes(String(code))) {
    if (String(code) === '03') return { header, body: { items: [], totalCount: 0 } }
    throw new Error(`외부 API 오류(${code}): ${header?.resultMsg ?? '알 수 없음'}`)
  }
  if (!response.ok) throw new Error(`외부 API HTTP ${response.status}`)

  return json?.response ?? json
}

// data.go.kr 의 items 는 배열 / {item: 배열|객체} / '' (결과 없음) 등 제각각이다.
export function toArray(items) {
  if (items == null || items === '') return []
  const inner = Array.isArray(items) ? items : (items.item ?? items)
  if (inner == null || inner === '') return []
  return Array.isArray(inner) ? inner : [inner]
}