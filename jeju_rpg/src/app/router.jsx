import { createBrowserRouter } from 'react-router-dom'
import AppLayout from './AppLayout.jsx'
import { RedirectIfAuthed, RequireAuth, RequireOnboarding } from '../components/common/RouteGuards.jsx'
import HomePage from '../pages/HomePage.jsx'
import AuthPage from '../pages/AuthPage.jsx'
import CharacterPage from '../pages/CharacterPage.jsx'
import StyleTestPage from '../pages/StyleTestPage.jsx'
import TravelSetupPage from '../pages/TravelSetupPage.jsx'
import AdventurePage from '../pages/AdventurePage.jsx'
import QuestPage from '../pages/QuestPage.jsx'
import MapPage from '../pages/MapPage.jsx'
import RecordsPage from '../pages/RecordsPage.jsx'
import TripRecordPage from '../pages/TripRecordPage.jsx'
import TripSummaryPage from '../pages/TripSummaryPage.jsx'
import ProfilePage from '../pages/ProfilePage.jsx'
import NotFoundPage from '../pages/NotFoundPage.jsx'

// Chapter/돌발/피드백/인증/Final은 별도 Route를 만들지 않고 /quest 내부 상태로 처리한다.
const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      // 공개
      {
        element: <RedirectIfAuthed />,
        children: [{ path: '/auth', element: <AuthPage /> }],
      },
      // 로그인 필요 (온보딩 진행 중)
      {
        element: <RequireAuth />,
        children: [
          { path: '/character', element: <CharacterPage /> },
          { path: '/style-test', element: <StyleTestPage /> },
          { path: '/setup', element: <TravelSetupPage /> },
        ],
      },
      // 로그인 + 온보딩 완료 필요
      {
        element: <RequireOnboarding />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/adventure', element: <AdventurePage /> },
          { path: '/quest', element: <QuestPage /> },
          { path: '/map', element: <MapPage /> },
          { path: '/records', element: <RecordsPage /> },
          { path: '/records/:tripId', element: <TripRecordPage /> },
          { path: '/summary/:tripId', element: <TripSummaryPage /> },
          { path: '/profile', element: <ProfilePage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export default router