import { PHOTO_JPEG_QUALITY, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE_PX, PHOTO_MIME } from '../constants/photoRules.js'

// 휴대폰 원본 사진(수 MB)을 업로드 전에 줄인다. (API/Storage 비용 절약, Vercel 요청 크기 한도 대비)
//  - 긴 변을 PHOTO_MAX_EDGE_PX 로 줄이고 JPEG(PHOTO_JPEG_QUALITY)로 다시 인코딩한다.
//  - canvas 로 다시 그리므로 EXIF(위치 정보 포함)는 자연스럽게 사라진다. 사진 인증은 EXIF 에 의존하지 않는다.
//  - 그래도 PHOTO_MAX_BYTES 보다 크면 품질/크기를 한 단계씩 낮춘다.
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' }) // 휴대폰 사진의 회전 정보를 반영
    } catch {
      /* 아래 <img> 방식으로 다시 시도 */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, PHOTO_MIME, quality))

// → { blob, width, height }  (이미지가 아니거나 읽을 수 없으면 throw)
export async function resizeImageFile(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('not_an_image')
  const bitmap = await loadBitmap(file)
  const srcW = bitmap.width ?? bitmap.naturalWidth
  const srcH = bitmap.height ?? bitmap.naturalHeight
  if (!srcW || !srcH) throw new Error('image_unreadable')

  let edge = PHOTO_MAX_EDGE_PX
  let quality = PHOTO_JPEG_QUALITY
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scale = Math.min(1, edge / Math.max(srcW, srcH))
    const width = Math.max(1, Math.round(srcW * scale))
    const height = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    const blob = await toBlob(canvas, quality)
    if (!blob) throw new Error('image_unreadable')
    if (blob.size <= PHOTO_MAX_BYTES || attempt === 3) {
      bitmap.close?.()
      return { blob, width, height }
    }
    edge = Math.round(edge * 0.8)
    quality = Math.max(0.5, quality - 0.1)
  }
  throw new Error('image_unreadable')
}

// Blob → base64 문자열 (data: 접두사 없이)
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('image_unreadable'))
    reader.readAsDataURL(blob)
  })
}
