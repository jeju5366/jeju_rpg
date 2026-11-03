import { CATEGORY_STYLE } from '../../constants/categoryStyle.js'
import { UI_TEXT } from '../../constants/uiText.js'

// 카테고리 EXP chip: "🏛️ 문화 +9". 퀘스트 카드의 "예상 성장"과 완료 팝업의 "획득한 성장/특별 보상"이 같은 모양을 쓴다.
//   category: explore | culture | food | relax | social | discovery   amount: 서버/기존 EXP 함수가 정한 값(여기서 계산하지 않는다)
//   label   : 카테고리 이름 대신 쓸 문구 (예: 발견 / 명소 발견)
export function CategoryChip({ category, amount, label }) {
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.explore
  return (
    <span className={`cat-chip cat-chip--${category}`}>
      <span aria-hidden="true">{style.icon}</span> {label ?? UI_TEXT.categories[category] ?? category}
      {amount !== undefined && <strong> +{amount}</strong>}
    </span>
  )
}

// chip 여러 개를 한 줄(필요하면 줄바꿈)로 나열한다. parts: [{ category, amount }]
export function CategoryChips({ parts, className = '' }) {
  return (
    <span className={`cat-chips ${className}`}>
      {parts.map((part) => (
        <CategoryChip key={part.category} category={part.category} amount={part.amount} />
      ))}
    </span>
  )
}
