import { useRef, useState } from 'react'
import { Button } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { saveMemoryPhoto } from '../../services/verification/photoService.js'
import { usePhotoStore } from '../../store/photoStore.js'

// "☆ 추억으로 남기기" → "★ 추억으로 저장됨". 사진 인증에 성공한 퀘스트에서만 보인다.
//   · 누를 때만 방금 인증에 쓴 사진(메모리에 잠깐 들고 있던 Blob)을 서버로 보내 Storage 에 영구 저장한다. 저장하지 않아도 퀘스트는 완료 상태 그대로다.
//   · 저장 중에는 다시 눌러도 요청이 한 번만 나가고, 서버도 퀘스트당 1장만 저장한다.
//   saved: 이미 저장된 퀘스트인지(서버 기록). 페이지를 다시 열었을 때도 ★ 로 보이게 한다.
export default function MemoryButton({ questId, saved = false, onSaved, className = '' }) {
  const text = UI_TEXT.photo.memory
  const blob = usePhotoStore((s) => s.verified[questId])
  const release = usePhotoStore((s) => s.release)
  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState(null)
  const sendingRef = useRef(false) // 연타 방지(즉시 잠금)

  if (saved || justSaved) return <div className={`fw-bold small ${className}`}>{text.saved}</div>
  if (!blob) return null // 사진을 이미 놓친 상태(새로고침 등)라면 저장할 수 없다

  const save = async () => {
    if (sendingRef.current) return
    sendingRef.current = true
    setBusy(true)
    setError(null)
    try {
      await saveMemoryPhoto({ questId, blob })
      release(questId) // 저장했으니 메모리의 사진은 놓는다
      setJustSaved(true)
      onSaved?.(questId)
    } catch (err) {
      setError(UI_TEXT.photo.errors[err.code] ?? text.failed)
    } finally {
      sendingRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <Button size="sm" variant="outline-warning" disabled={busy} onClick={save}>
        {busy ? text.saving : text.save}
      </Button>
      <span className="small text-muted ms-2">{text.hint}</span>
      {error && <div className="small text-danger mt-1">{error}</div>}
    </div>
  )
}
