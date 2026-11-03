import { PHOTO_ALLOWED_MIME, PHOTO_MAX_BYTES } from '../../../src/constants/photoRules.js'
import { HttpError } from '../http.js'

// 업로드된 이미지(base64)를 확인한다. 클라이언트가 말한 mime 을 믿지 않고 파일 앞부분(magic bytes)으로 종류를 확인한다.
// EXIF 등 메타데이터는 보지 않는다. (사진 인증은 EXIF 위치정보에 의존하지 않는다 — 위치는 GPS 인증이 따로 한다)
function sniff(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

// → { buffer, mime }  / 형식이 잘못되면 400(image_invalid), 너무 크면 413(image_too_large)
export function decodeImage(base64) {
  if (typeof base64 !== 'string' || !base64) throw new HttpError(400, 'image_invalid')
  // 크기는 디코딩 전에 먼저 막는다. (base64 는 원본의 약 4/3)
  if (base64.length > Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 8) throw new HttpError(413, 'image_too_large')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) throw new HttpError(400, 'image_invalid')
  if (buffer.length > PHOTO_MAX_BYTES) throw new HttpError(413, 'image_too_large')
  const mime = sniff(buffer)
  if (!mime || !PHOTO_ALLOWED_MIME.includes(mime)) throw new HttpError(400, 'image_invalid')
  return { buffer, mime }
}
