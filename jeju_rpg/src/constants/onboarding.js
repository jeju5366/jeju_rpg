// 온보딩 선택지. 임시 초안이라 이 파일에서만 바꾸면 된다.
// 개발 단계라 텍스트로 표시. 나중에 image 필드를 추가해 이미지로 교체한다.
export const BODY_TYPES = [
  { id: 'male', label: '남성형 체형' },
  { id: 'female', label: '여성형 체형' },
]

export const NICKNAME_MAX = 20

export const COMPANIONS = [
  { id: 'solo', label: '혼자' },
  { id: 'couple', label: '연인' },
  { id: 'friends', label: '친구' },
  { id: 'family', label: '가족' },
  { id: 'other', label: '기타' },
]

export const TRANSPORTS = [
  { id: 'rental_car', label: '렌터카' },
  { id: 'public_transit', label: '대중교통' },
  { id: 'taxi', label: '택시' },
  { id: 'bike', label: '자전거/스쿠터' },
  { id: 'walk', label: '도보 중심' },
]