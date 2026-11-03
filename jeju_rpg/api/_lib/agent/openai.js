import { optionalEnv, requireEnv } from '../env.js'

// 모델 가격(USD / 1M 토큰: [입력, 출력]). 비용 로그용 "추정치"이며, 목록에 없는 모델은 0 으로 기록한다.
const PRICING = {
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4o-mini': [0.15, 0.6],
}

// 목록에 없는 모델은 .env 의 OPENAI_PRICE_INPUT_PER_1M / OPENAI_PRICE_OUTPUT_PER_1M 로 가격을 줄 수 있다. 없으면 0.
export function estimateCostUsd(model, inputTokens, outputTokens) {
  const envInput = Number(process.env.OPENAI_PRICE_INPUT_PER_1M)
  const envOutput = Number(process.env.OPENAI_PRICE_OUTPUT_PER_1M)
  const price = envInput > 0 && envOutput > 0 ? [envInput, envOutput] : PRICING[model]
  return price ? (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000 : 0
}

// gpt-5 / gpt-6 / o 계열은 추론(reasoning) 모델이라 reasoning.effort 를 보낼 수 있고, 추론 토큰도 출력 한도에 포함된다.
const isReasoningModel = (model) => /^(gpt-[56]|o\d)/.test(model)

// OpenAI Responses API + JSON Schema(strict) 구조화 출력. 호출 1회 = 요청 1건 (자동 재시도는 호출하는 쪽에서 최대 1회).
export async function callResponses({ system, user, schema, name }) {
  const apiKey = requireEnv('OPENAI_API_KEY')
  const model = optionalEnv('OPENAI_MODEL', 'gpt-4.1-mini')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      text: { format: { type: 'json_schema', name, strict: true, schema } },
      // 추론 모델은 추론 토큰이 한도를 먹으므로 넉넉히 주고, 추론 강도는 낮게(OPENAI_REASONING_EFFORT 로 변경 가능) 둔다.
      ...(isReasoningModel(model)
        ? { reasoning: { effort: optionalEnv('OPENAI_REASONING_EFFORT', 'low') }, max_output_tokens: 8000 }
        : { max_output_tokens: 2500 }),
      store: false,
    }),
    signal: AbortSignal.timeout(50000),
  })
  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }

  const body = await response.json()
  const parts = (body.output ?? []).flatMap((item) => item.content ?? [])
  if (parts.some((part) => part.type === 'refusal')) throw new Error('OpenAI 가 응답을 거절했어')
  const text = parts.find((part) => part.type === 'output_text')?.text ?? body.output_text
  if (!text) {
    const reason = body.incomplete_details?.reason
    throw new Error(`OpenAI 응답이 비었어 (status: ${body.status}${reason ? `, ${reason}` : ''})`)
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('OpenAI 응답이 JSON 이 아니야')
  }
  return {
    json,
    usage: { model, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
  }
}