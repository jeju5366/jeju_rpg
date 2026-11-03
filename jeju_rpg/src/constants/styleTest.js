// 여행 성향 테스트 문항 (확정안, 12문항 상황형 4지선다). 문구와 점수는 이 파일에서만 바꾼다. 사용자에게는 카테고리/점수를 보여주지 않는다.
//
// 기본 여행 성향 6가지 (0~100, 장기 선호값 = base preference)
//   explore   탐험 : 활동성 / 이동 / 도전 / 몸을 쓰는 경험
//   culture   문화 : 역사 / 예술 / 지역 이야기 / 전통
//   food      미식 : 여행에서 먹는 경험을 중요하게 생각하는 정도
//   relax     휴식 : 여유 / 풍경 / 느린 일정 / 쉬어가는 여행
//   social    교류 : 사람 / 현지인 / 동행 / 함께하는 체험
//   discovery 발견 : 유명/비유명이 아니라, 아직 경험해보지 않은 새로운 장소·활동·분위기를 접하고 싶은 성향
//             (기획서의 `discover`. DB 컬럼/Agent context 키는 기존 이름인 `discovery` 를 그대로 쓴다.)
//
// 선택지 scoring
//   scores   : { 성향: 점수 } — 주 성향 +2, 보조 성향 +1 (한 선택지는 최대 2개 성향). 예외: Q9 C 의 food +3.
//   meal / dessert : (Q9 전용) meal_preference / dessert_preference 의 기본값(0~100). 서로 독립이라 둘 다 높거나 둘 다 낮을 수 있다.
//   dessertBonus   : (Q7 C) dessert_preference 에 더하는 보정값. 최대 100.
export const STYLE_AXES = ['explore', 'culture', 'food', 'relax', 'social', 'discovery']
export const MEAL_QUESTION_ID = 'q9'

export const STYLE_QUESTIONS = [
  {
    id: 'q1',
    text: '예상보다 일정이 2시간 정도 일찍 끝났어. 가장 끌리는 건?',
    options: [
      { label: '조금 멀어도 전망 좋은 곳까지 더 가본다.', scores: { explore: 2 } },
      { label: '근처에서 아직 경험해보지 않은 장소를 찾아본다.', scores: { discovery: 2 } },
      { label: '지역 분위기를 느낄 수 있는 전시나 문화공간에 들른다.', scores: { culture: 2 } },
      { label: '경치 좋은 곳에 자리 잡고 천천히 쉬어간다.', scores: { relax: 2 } },
    ],
  },
  {
    id: 'q2',
    text: '가보고 싶은 장소가 있는데 이동이 생각보다 오래 걸린대. 어떻게 할래?',
    options: [
      { label: '정말 끌리는 곳이면 이동시간이 길어도 가본다.', scores: { explore: 2 } },
      { label: '비슷한 분위기의 가까운 장소를 새로 찾아본다.', scores: { discovery: 2 } },
      { label: '이동에 시간을 쓰기보다 지금 있는 지역을 여유롭게 즐긴다.', scores: { relax: 2 } },
      { label: '오래 이동하는 대신 지금 있는 지역의 볼거리나 이야기를 더 찾아본다.', scores: { culture: 2 } },
    ],
  },
  {
    id: 'q3',
    text: '여행 중 갑자기 비가 꽤 많이 오기 시작했어. 어떻게 할래?',
    options: [
      { label: '근처 박물관이나 전시 공간으로 일정을 바꾼다.', scores: { culture: 2 } },
      { label: '비가 덜 오는 곳이나 다른 지역으로 이동해본다.', scores: { explore: 2, discovery: 1 } },
      { label: '분위기 좋은 실내 공간에서 쉬면서 비가 잦아들길 기다린다.', scores: { relax: 2 } },
      { label: '원래 계획에 없던 실내 체험이나 장소를 찾아본다.', scores: { discovery: 2 } },
    ],
  },
  {
    id: 'q4',
    text: '현지 시장을 걷다가 처음 보는 음식과 작은 가게들이 보여.',
    options: [
      { label: '궁금한 음식을 하나 골라 직접 먹어본다.', scores: { food: 2, discovery: 1 } },
      { label: '상인에게 이 지역에서 뭘 먹어보면 좋을지 물어본다.', scores: { social: 2, food: 1 } },
      { label: '시장 안쪽까지 걸어보며 분위기와 가게들을 더 둘러본다.', scores: { discovery: 2, explore: 1 } },
      { label: '붐비는 곳은 오래 머물지 않고 분위기만 가볍게 보고 지나간다.', scores: { relax: 2 } },
    ],
  },
  {
    id: 'q5',
    text: '작은 체험 프로그램에 참여할 기회가 생겼어. 어떤 쪽이 더 끌려?',
    options: [
      { label: '현지 사람이 직접 알려주는 체험', scores: { social: 2, culture: 1 } },
      { label: '동행과 함께 결과물을 만드는 체험', scores: { social: 2 } },
      { label: '혼자 자유롭게 둘러보는 체험', scores: { discovery: 2 } },
      { label: '체험보다 주변을 더 돌아보는 것', scores: { explore: 2 } },
    ],
  },
  {
    id: 'q6',
    text: '지나가다가 평소엔 해볼 생각이 없던 체험 프로그램을 발견했어.',
    options: [
      { label: '언제 또 해보겠냐 싶어서 바로 참여해본다.', scores: { discovery: 2, explore: 1 } },
      { label: '어떤 체험인지 지역적인 의미나 이야기를 먼저 알아본다.', scores: { culture: 2, discovery: 1 } },
      { label: '다른 사람들과 함께하는 체험이라면 더 해보고 싶다.', scores: { social: 2 } },
      { label: '일정이 갑자기 바뀌는 건 부담스러워서 원래 계획을 이어간다.', scores: { relax: 2 } },
    ],
  },
  {
    id: 'q7',
    text: '오후가 되니 생각보다 조금 지쳤어. 다음 선택은?',
    options: [
      { label: '가까운 곳에서 편하게 쉬면서 남은 일정을 줄인다.', scores: { relax: 2 } },
      { label: '이동은 적게 하되 볼거리가 있는 실내 장소를 간다.', scores: { culture: 2, relax: 1 } },
      { label: '카페에 들러 음료나 디저트를 즐기며 잠깐 쉬어간다.', scores: { food: 1, relax: 2 }, dessertBonus: 10 },
      { label: '오래 걷진 않더라도 아직 안 가본 가까운 곳 하나는 들러본다.', scores: { discovery: 2 } },
    ],
  },
  {
    id: 'q8',
    text: '이미 한 번 가봐서 만족했던 장소와, 아직 한 번도 경험하지 못한 장소가 비슷하게 끌려. 어디로 갈래?',
    options: [
      { label: '아직 안 가본 곳을 선택한다.', scores: { discovery: 2 } },
      { label: '다시 가도 만족할 것 같은 익숙한 곳을 선택한다.', scores: { relax: 2 } },
      { label: '더 많이 걷고 체험할 수 있는 쪽을 선택한다.', scores: { explore: 2 } },
      { label: '그 지역 이야기를 더 깊게 알 수 있는 쪽을 선택한다.', scores: { culture: 2 } },
    ],
  },
  {
    id: 'q9',
    text: '여행 중 한 번쯤 먹는 즐거움에 시간을 써보고 싶다면, 어떤 쪽이 더 끌려?',
    options: [
      { label: '현지 음식으로 제대로 한 끼를 먹는다.', scores: { food: 2 }, meal: 90, dessert: 30 },
      { label: '식사는 간단히 하고 카페나 디저트를 찾아간다.', scores: { food: 2 }, meal: 35, dessert: 90 },
      { label: '식사를 즐긴 뒤 분위기 좋은 카페나 디저트까지 자연스럽게 이어간다.', scores: { food: 3 }, meal: 80, dessert: 80 },
      { label: '먹는 건 빠르게 해결하고 다른 일정에 시간을 더 쓴다.', scores: { food: 0 }, meal: 20, dessert: 20 },
    ],
  },
  {
    id: 'q10',
    text: '저녁 일정이 끝났는데 숙소에 들어가기엔 조금 아쉬워.',
    options: [
      { label: '야경을 볼 수 있는 곳까지 조금 더 걸어본다.', scores: { explore: 2 } },
      { label: '낮에는 안 가봤던 근처 장소를 하나 더 들러본다.', scores: { discovery: 2 } },
      { label: '작은 공연이나 야시장처럼 사람들이 모이는 곳에 들러본다.', scores: { social: 2, culture: 1 } },
      { label: '숙소 근처에서 간단히 먹거나 쉬면서 하루를 마무리한다.', scores: { relax: 2, food: 1 } },
    ],
  },
  {
    id: 'q11',
    text: '여행을 마치고 돌아왔을 때, 가장 아쉬울 것 같은 건?',
    options: [
      { label: '조금 더 돌아다니면서 다양한 곳을 가보지 못한 것.', scores: { explore: 2 } },
      { label: '그냥 보고 지나치기만 하고, 그곳 얘기를 제대로 못 알아본 것.', scores: { culture: 2 } },
      { label: '기억에 남는 음식을 충분히 즐기지 못한 것.', scores: { food: 2 } },
      { label: '처음 해보는 경험을 많이 남기지 못한 것.', scores: { discovery: 2 } },
    ],
  },
  {
    id: 'q12',
    text: '하루가 끝났을 때 “오늘 여행 잘했다”는 느낌이 가장 드는 순간은?',
    options: [
      { label: '예상보다 많은 곳을 움직이며 알차게 다녀왔을 때.', scores: { explore: 2 } },
      { label: '좋은 사람들과 이야기하거나 뭔가를 같이 경험했을 때.', scores: { social: 2 } },
      { label: '서두르지 않고 내가 좋아하는 풍경과 분위기를 충분히 즐겼을 때.', scores: { relax: 2 } },
      { label: '그날 처음 접한 장소나 경험이 기억에 강하게 남았을 때.', scores: { discovery: 2 } },
    ],
  },
]
