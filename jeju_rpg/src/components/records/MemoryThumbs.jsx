import { useEffect, useState } from 'react'
import { getMemoryUrl } from '../../services/supabase/memoryRepo.js'

// 추억 사진 미리보기. private bucket 이라 임시 주소를 받아서 보여준다. (limit 장만 받는다. 실패한 사진은 건너뜀)
export default function MemoryThumbs({ photos, limit = 4 }) {
  const [urls, setUrls] = useState([])
  const key = photos
    .slice(0, limit)
    .map((p) => p.storagePath)
    .join('|')
  useEffect(() => {
    let active = true
    Promise.all(
      photos
        .slice(0, limit)
        .map((p) => getMemoryUrl(p.storagePath).then((url) => ({ id: p.id, url, caption: p.caption })).catch(() => null)),
    ).then((list) => active && setUrls(list.filter(Boolean)))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, limit])

  return (
    <div className="memory-thumbs">
      {urls.map((item) => (
        <img key={item.id} src={item.url} alt={item.caption ?? '추억 사진'} loading="lazy" />
      ))}
    </div>
  )
}
