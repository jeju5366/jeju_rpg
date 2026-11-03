// 데모 장소 데이터. 좌표는 대략값이며 실제 데이터가 아니다. (mock/demo)
// isLandmark 는 서버 whitelist 값이다. LLM 이 판단하지 않는다.
export const MOCK_PLACES = [
  { placeId: 'demo-seongsan', name: '성산일출봉', contentTypeId: 12, address: '제주 서귀포시 성산읍', lat: 33.458, lng: 126.9425, isLandmark: true },
  { placeId: 'demo-seopjikoji', name: '섭지코지', contentTypeId: 12, address: '제주 서귀포시 성산읍', lat: 33.424, lng: 126.93, isLandmark: false },
  { placeId: 'demo-manjanggul', name: '만장굴', contentTypeId: 12, address: '제주 제주시 구좌읍', lat: 33.5283, lng: 126.7714, isLandmark: true },
  { placeId: 'demo-hyeopjae', name: '협재해수욕장', contentTypeId: 12, address: '제주 제주시 한림읍', lat: 33.394, lng: 126.2394, isLandmark: false },
  { placeId: 'demo-osulloc', name: '오설록 티뮤지엄', contentTypeId: 14, address: '제주 서귀포시 안덕면', lat: 33.3057, lng: 126.2893, isLandmark: false },
  { placeId: 'demo-stonepark', name: '제주 돌문화공원', contentTypeId: 14, address: '제주 제주시 조천읍', lat: 33.4284, lng: 126.64, isLandmark: false },
  { placeId: 'demo-yongduam', name: '용두암', contentTypeId: 12, address: '제주 제주시 용담동', lat: 33.5162, lng: 126.5123, isLandmark: false },
  { placeId: 'demo-dongmun', name: '동문시장', contentTypeId: 38, address: '제주 제주시 이도동', lat: 33.5122, lng: 126.5278, isLandmark: false },
  { placeId: 'demo-cheonjiyeon', name: '천지연폭포', contentTypeId: 12, address: '제주 서귀포시 천지동', lat: 33.247, lng: 126.5547, isLandmark: false },
  { placeId: 'demo-saebyeol', name: '새별오름', contentTypeId: 12, address: '제주 제주시 애월읍', lat: 33.3643, lng: 126.3571, isLandmark: false },
  { placeId: 'demo-camellia', name: '카멜리아힐', contentTypeId: 12, address: '제주 서귀포시 안덕면', lat: 33.2903, lng: 126.3698, isLandmark: false },
  { placeId: 'demo-saryeoni', name: '사려니숲길', contentTypeId: 12, address: '제주 제주시 조천읍', lat: 33.4067, lng: 126.6347, isLandmark: false },
  { placeId: 'demo-restaurant-1', name: '데모 흑돼지 식당', contentTypeId: 39, address: '제주 제주시 연동', lat: 33.4890, lng: 126.4930, isLandmark: false },
  { placeId: 'demo-restaurant-2', name: '데모 해녀 음식점', contentTypeId: 39, address: '제주 서귀포시 성산읍', lat: 33.4600, lng: 126.9300, isLandmark: false },
  { placeId: 'demo-festival-1', name: '데모 감귤 축제', contentTypeId: 15, address: '제주 제주시 조천읍', lat: 33.5000, lng: 126.6000, isLandmark: false, eventStartDate: '2026-11-01', eventEndDate: '2026-11-30' },
]