// 개발용 도구: 실제 OpenAI 사진 판정(judgePhoto)을 이미지 파일로 직접 확인한다. (DB/로그인 없이, 서비스 UX에는 노출되지 않는다)
//
//   node --env-file=.env scripts/dev/photo-judge-check.mjs <이미지 폴더>
//   폴더 안 파일 이름으로 기대 결과를 정한다: granite*(pass 기대) / cat*, car*(fail 기대) / blurry*(uncertain 기대)
//
// 테스트 이미지는 프로젝트에 포함하지 않는다. (외부 이미지를 영구 보관/배포하지 않는다)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { judgePhoto, photoModel } from '../../api/_lib/photo/judge.js'
import { decodeImage } from '../../api/_lib/photo/image.js'

const dir = process.argv[2]
if (!dir) {
  console.error('사용법: node --env-file=.env scripts/dev/photo-judge-check.mjs <이미지 폴더>')
  process.exit(1)
}

// 테스트용 임시 퀘스트 (실제 퀘스트 데이터가 아니라 이 스크립트 안의 fixture)
const quest = {
  id: 'fixture-granite',
  title: '화강암 사진 인증',
  description: '화강암 바위를 사진으로 남겨봐.',
  verification_type: 'photo_ai',
  data: { photoSubject: 'granite rock / granite stone' },
}
const expectedOf = (name) => (name.startsWith('granite') ? 'pass' : name.startsWith('blurry') ? 'uncertain' : 'fail')

console.log(`model: ${photoModel()} / detail: low\n`)
let totalIn = 0
let totalOut = 0
for (const name of readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()) {
  const image = readFileSync(join(dir, name))
  const { buffer, mime } = decodeImage(image.toString('base64'))
  const started = Date.now()
  try {
    const out = await judgePhoto({ quest, image: buffer, mime })
    totalIn += out.usage.inputTokens
    totalOut += out.usage.outputTokens
    const expected = expectedOf(name)
    console.log(`${name.padEnd(14)} ${String(Math.round(buffer.length / 1024)).padStart(4)}KB  기대=${expected.padEnd(9)} 결과=${out.result.padEnd(9)} ${out.result === expected ? 'OK ' : 'DIFF'}  ${Date.now() - started}ms  tokens in/out=${out.usage.inputTokens}/${out.usage.outputTokens}  "${out.reason}"`)
  } catch (error) {
    console.log(`${name.padEnd(14)} 오류: ${error.message}`)
  }
}
console.log(`\n합계 tokens in/out = ${totalIn}/${totalOut}`)
