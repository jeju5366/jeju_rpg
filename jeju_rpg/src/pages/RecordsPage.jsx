import PastTripsPanel from '../components/records/PastTripsPanel.jsx'
import { UI_TEXT } from '../constants/uiText.js'

// 기록 탭: 지난 여행 목록. (방문/추억 기록은 여행 상세 기록에서 본다)
export default function RecordsPage() {
  return (
    <>
      <h1 className="h4 mb-3">{UI_TEXT.pages.records.title}</h1>
      <PastTripsPanel />
    </>
  )
}
