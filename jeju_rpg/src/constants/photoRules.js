// 사진 인증 / 추억 사진 규칙 상수 (10단계). 서버(api/)와 화면이 같이 쓴다. 숫자는 여기서만 바꾸면 된다.

// ───────── 사진 AI 인증 ─────────
export const PHOTO_AI_MAX_ATTEMPTS = 2 // 한 퀘스트에서 AI 가 판정(pass/uncertain/fail)하는 최대 횟수 (최초 1 + 재촬영 1)
export const PHOTO_AI_MAX_ERRORS = 2 // AI 호출 자체가 실패(장애/시간 초과/형식 오류)한 횟수가 이만큼이면 AI 인증을 닫고 직접 확인으로 안내
export const PHOTO_AI_DETAIL = 'low' // 이미지 입력 detail. 사진 인증은 고정밀 분석이 필요 없어서 low 우선
export const PHOTO_AI_TIMEOUT_MS = 25000
export const PHOTO_AI_MAX_OUTPUT_TOKENS = 300 // 짧은 구조화 응답. (추론 모델은 PHOTO_AI_MAX_OUTPUT_TOKENS_REASONING)
export const PHOTO_AI_MAX_OUTPUT_TOKENS_REASONING = 1500 // 추론 토큰이 한도를 먹는 모델용
export const PHOTO_AI_REASON_MAX_CHARS = 60 // 사용자에게 보여줄 한 줄 사유 길이

export const PHOTO_RESULTS = ['pass', 'uncertain', 'fail']
export const PHOTO_MODES = ['ai_check', 'upload_only']

// 사람이 중심인 퀘스트(셀카/가족·친구 사진 등)는 AI 로 사진 속 사람을 분석하지 않고 "업로드만 확인"으로 처리한다.
export const PHOTO_PEOPLE_KEYWORDS = /(셀카|셀피|인물|사람|얼굴|가족|친구|동행|함께|같이|단체|포즈|커플|아이와)/

// ───────── 이미지 크기 최적화 (업로드 전에 브라우저에서 줄인다) ─────────
export const PHOTO_MAX_EDGE_PX = 1280 // 긴 변 최대 픽셀
export const PHOTO_JPEG_QUALITY = 0.8
export const PHOTO_MIME = 'image/jpeg'
export const PHOTO_MAX_BYTES = 1_500_000 // 서버가 받는 이미지 최대 크기(압축 후). Vercel 요청 본문 한도(4.5MB)보다 충분히 작게
export const PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

// ───────── 추억 사진 (Supabase Storage) ─────────
export const MEMORY_BUCKET = 'travel-memories'
export const MEMORY_CAPTION_MAX_CHARS = 200
