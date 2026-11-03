import { useCallback, useEffect, useState } from 'react'
import { Alert, Card, Spinner } from 'react-bootstrap'
import RewardNotice from '../components/common/RewardNotice.jsx'
import FreeExpPanel from '../components/profile/FreeExpPanel.jsx'
import LevelRow from '../components/profile/LevelRow.jsx'
import PastTripsPanel from '../components/records/PastTripsPanel.jsx'
import StyleProfileCard from '../components/style/StyleProfileCard.jsx'
import { UI_TEXT } from '../constants/uiText.js'
import { investFreeExp } from '../services/agent/progressionService.js'
import { fetchPendingFreeExp } from '../services/supabase/expRepo.js'
import { ensureProfile, fetchTravelPreferences } from '../services/supabase/profileService.js'
import { useAuthStore } from '../store/authStore.js'
import { EXP_CATEGORY_KEYS, expsFromProfile, levelsOf, totalExp } from '../utils/level.js'

export default function ProfilePage() {
  const text = UI_TEXT.progression.profile
  const { user, profile, setProfile } = useAuthStore()
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [investingId, setInvestingId] = useState(null)
  const [error, setError] = useState(null)
  const [rewards, setRewards] = useState(null)
  const [styleState, setStyleState] = useState('loading') // 성향 카드만 따로 로딩/실패를 처리한다 (EXP/레벨 화면에 영향 없음)
  const [preferences, setPreferences] = useState(null)

  const load = useCallback(async () => {
    const [fresh, pending] = await Promise.all([ensureProfile(user.id), fetchPendingFreeExp(user.id)])
    setProfile(fresh)
    setGrants(pending)
  }, [user.id, setProfile])

  useEffect(() => {
    load()
      .catch((err) => setError(`${text.loadFailed} (${err.message})`))
      .finally(() => setLoading(false))
  }, [load, text.loadFailed])

  // 최신 여행 성향 (재테스트 후 다시 들어오면 새 값이 보인다)
  useEffect(() => {
    let active = true
    fetchTravelPreferences(user.id)
      .then((row) => {
        if (!active) return
        setPreferences(row)
        setStyleState('ready')
      })
      .catch(() => active && setStyleState('error'))
    return () => {
      active = false
    }
  }, [user.id])

  const handleInvest = async (grant, category) => {
    if (investingId) return
    setInvestingId(grant.id)
    setError(null)
    setRewards(null)
    try {
      const result = await investFreeExp(grant.id, category)
      setRewards({ levelUps: result.levelUps })
    } catch (err) {
      setError(text.errors[err.code] ?? err.message)
    } finally {
      await load().catch(() => {})
      setInvestingId(null)
    }
  }

  if (loading) return <Spinner animation="border" />

  // 레벨은 저장하지 않고 EXP 에서 계산한다.
  const exps = expsFromProfile(profile)
  const levels = levelsOf(exps)

  return (
    <>
      <h1 className="h4 mb-1">{UI_TEXT.pages.profile.title}</h1>
      {profile?.nickname && <div className="text-muted mb-3">{profile.nickname}</div>}
      {error && <Alert variant="danger">{error}</Alert>}
      <RewardNotice rewards={rewards} onClose={() => setRewards(null)} />

      <Card className="mb-3">
        <Card.Body>
          <LevelRow label={text.overall} levelInfo={levels.overall} exp={totalExp(exps)} />
          {EXP_CATEGORY_KEYS.map((key) => (
            <LevelRow key={key} label={UI_TEXT.categories[key]} levelInfo={levels[key]} exp={exps[key]} />
          ))}
        </Card.Body>
      </Card>

      <StyleProfileCard state={styleState} preferences={preferences} />
      <FreeExpPanel grants={grants} investingId={investingId} onInvest={handleInvest} />
      <PastTripsPanel />
    </>
  )
}