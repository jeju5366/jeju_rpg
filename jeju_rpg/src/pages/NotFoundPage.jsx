import { Link } from 'react-router-dom'
import PagePlaceholder from '../components/common/PagePlaceholder.jsx'
import { UI_TEXT } from '../constants/uiText.js'

export default function NotFoundPage() {
  const { title, desc } = UI_TEXT.pages.notFound
  return (
    <PagePlaceholder title={title} desc={desc}>
      <Link to="/">{UI_TEXT.backHome}</Link>
    </PagePlaceholder>
  )
}
