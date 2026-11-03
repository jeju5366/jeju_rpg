// 지도 마커의 "모양" 설정. 14단계 Pixel RPG UI 에서 이 파일(과 MarkerIcon)만 교체하면 되도록 분리했다.
// kind 는 의미(무엇을 나타내는가)이고, 여기서 색/라벨/우선순위를 정한다. 지도 컴포넌트는 kind 만 알고 모양은 모른다.
//
// kind
//   me        내 현재 위치
//   anchor    현재 챕터의 anchor(= 현재 핵심 퀘스트 목적지)
//   optional  현재 챕터의 선택 퀘스트 장소(anchor 와 다른 곳)
//   upcoming  이후 챕터의 주요 장소
//   nearby    자유여행 중 주변 주요 장소 후보
//   candidate 자유여행 중 감지된 방문 후보
//   visited   방문 확정된 장소
export const MARKER_KINDS = {
  me: { color: '#0d6efd', label: '내 위치', zIndex: 100 },
  target: { color: '#d63384', label: '가야 할 곳', zIndex: 110 }, // 퀘스트/공항에서 "지도에서 보기"로 넘어온 강조 마커
  anchor: { color: '#dc3545', label: '현재 목적지', zIndex: 90 },
  optional: { color: '#fd7e14', label: '선택 장소', zIndex: 70 },
  upcoming: { color: '#6c757d', label: '이후 장소', zIndex: 60 },
  candidate: { color: '#6f42c1', label: '방문 후보', zIndex: 80 },
  nearby: { color: '#20c997', label: '주변 장소', zIndex: 40 },
  visited: { color: '#198754', label: '방문한 곳', zIndex: 50 },
}

export const MARKER_LEGEND = ['me', 'anchor', 'upcoming', 'nearby', 'candidate', 'visited']

// 마커 HTML. 지금은 단순한 색 점 + 이름이다. (Pixel RPG 아이콘/도트 마커로 바꿀 때 여기만 고친다)
export function markerHtml(kind, title) {
  const style = MARKER_KINDS[kind] ?? MARKER_KINDS.nearby
  const safe = String(title ?? '').replace(/[<>&"]/g, '')
  const dot = kind === 'me' ? 18 : kind === 'target' ? 22 : 14
  return `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);pointer-events:auto">
    ${safe && kind !== 'me' ? `<span style="background:#fff;border:${kind === 'target' ? 2 : 1}px solid ${style.color};color:#212529;font-size:${kind === 'target' ? 12 : 11}px;font-weight:${kind === 'target' ? 700 : 400};line-height:1.2;padding:1px 5px;border-radius:4px;margin-bottom:2px;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis">${safe}</span>` : ''}
    <span style="width:${dot}px;height:${dot}px;border-radius:50%;background:${style.color};border:2px solid #fff;box-shadow:0 0 0 1px ${style.color}"></span>
  </div>`
}
