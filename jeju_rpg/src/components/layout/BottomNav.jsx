import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '../../constants/routes.js'

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="주요 메뉴">
      {NAV_ITEMS.map(({ path, label }) => (
        <NavLink key={path} to={path} end className="bottom-nav__item">
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
