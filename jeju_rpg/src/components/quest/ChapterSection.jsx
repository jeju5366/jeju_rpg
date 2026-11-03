import { useState } from 'react'
import { Badge, Button, Card } from 'react-bootstrap'
import { UI_TEXT } from '../../constants/uiText.js'
import { mapFocusTarget, optionalHasOwnPlace } from '../../utils/questLocation.js'
import { isQuestOpen, partitionChapterQuests, questExpPreview, toggled } from '../../utils/questLayout.js'
import CompactQuestRow from './CompactQuestRow.jsx'
import QuestCard from './QuestCard.jsx'

const STATUS_COLOR = { active: 'primary', core_completed: 'info', completed: 'success', skipped: 'secondary' }

// "현재 챕터" 1개만 보여준다. 모바일에서 스크롤이 길어지지 않게 밀도를 정리했다. (퀘스트 로직은 그대로, 표시 방식만 다르다)
//   · 핵심 퀘스트: 미완료면 펼침(기본). 완료되면 한 줄("✓ 핵심 퀘스트 완료 · +N EXP · 다시 보기")로 접히고 누르면 다시 펼친다.
//   · 선택 퀘스트: 미완료는 compact 카드(제목 / 인증 방식 · EXP / ›). 누르면 펼치고 다시 누르면 접는다. 인증 중이거나 사용자가 연 카드는 자동으로 닫지 않는다.
//   · 완료한 선택 퀘스트: 하나의 접힌 그룹("✓ 완료한 선택 퀘스트 N개 [펼치기]"). 숨기거나 지우지 않고 접어 둘 뿐이다.
//   · 챕터 이동 버튼은 항상 1개: 모바일에서는 bottom nav 바로 위에 고정(sticky), 데스크톱에서는 카드 안 일반 위치.
// 접힘/펼침은 이 컴포넌트의 local state 로만 기억한다. (DB/전역 store 없음, 새로고침하면 기본 상태로)
// preview: 다음 챕터 예고(compact) 요소. 챕터 이동 버튼 바로 위에 놓인다.
export default function ChapterSection({
  chapter,
  position,
  quests,
  completedIds,
  busyQuestId,
  gpsBusyQuestId,
  gpsFeedback,
  activeQuestId = null,
  progressByQuestId,
  memoryIds,
  revealing,
  disabled,
  advance,
  preview = null,
  location = null,
  onViewMap = null,
  onComplete,
  onGpsComplete,
  onPhoto,
  onReveal,
}) {
  const text = UI_TEXT.quest
  const layout = UI_TEXT.questLayout
  const { core, coreDone, pending, done, hiddenCount } = partitionChapterQuests({ quests, completedIds })

  const [openIds, setOpenIds] = useState(() => new Set()) // 사용자가 직접 펼친 선택 퀘스트
  const [groupOpen, setGroupOpen] = useState(false) // 완료한 선택 퀘스트 그룹
  const [coreOpen, setCoreOpen] = useState(false) // 완료된 핵심 퀘스트 "다시 보기"
  const [baselineDone] = useState(done.length) // 이 화면을 연 뒤 새로 완료된 선택 퀘스트 수를 알려주기 위한 기준(처음 한 번만 정해진다)
  const recentlyDone = Math.max(0, done.length - baselineDone)

  const cardProps = (quest) => ({
    quest,
    progress: progressByQuestId?.get(quest.id) ?? null,
    memorySaved: memoryIds?.has(quest.id) ?? false,
    busy: busyQuestId === quest.id,
    gpsBusy: gpsBusyQuestId === quest.id,
    gpsFeedback: gpsFeedback?.questId === quest.id ? gpsFeedback : null,
    disabled,
    onComplete: () => onComplete(quest),
    onGpsComplete: () => onGpsComplete(quest),
    onPhoto: () => onPhoto(quest),
  })

  const coreExp = core ? questExpPreview(core, progressByQuestId?.get(core.id) ?? null) : null

  return (
    <Card className="mb-3 border-primary">
      <Card.Body className="quest-chapter">
        <div className="d-flex justify-content-between align-items-start mb-1">
          <div>
            <div className="small text-muted">
              {UI_TEXT.progression.chapterOf} {position.index} / {position.total}
            </div>
            <Card.Title as="h2" className="h5 mb-0">
              {chapter.title}
            </Card.Title>
          </div>
          <Badge bg={STATUS_COLOR[chapter.status] ?? 'secondary'}>{text.chapterStatus[chapter.status] ?? chapter.status}</Badge>
        </div>
        <Card.Text className="text-muted small clamp-2">{chapter.summary}</Card.Text>
        {location}

        {/* 핵심 퀘스트: 미완료면 펼침 / 완료면 한 줄로 접힘(다시 보기) */}
        {core && !coreDone && <QuestCard {...cardProps(core)} completed={false} canComplete={chapter.status === 'active'} />}
        {core && coreDone && (
          <div className="mb-2">
            <button type="button" className="quest-done-row" aria-expanded={coreOpen} onClick={() => setCoreOpen((open) => !open)}>
              <span>
                <span aria-hidden="true">✓</span> {layout.coreDone}
                {coreExp?.earned != null && ` · +${coreExp.earned} ${UI_TEXT.progression.expPreview}`}
              </span>
              <span className="quest-done-row__action">{coreOpen ? layout.collapse : layout.review}</span>
            </button>
            {coreOpen && (
              <div className="mt-1">
                <QuestCard {...cardProps(core)} completed canComplete={false} onCollapse={() => setCoreOpen(false)} />
              </div>
            )}
          </div>
        )}

        {/* 선택 퀘스트(미완료): compact 카드 */}
        {(pending.length > 0 || hiddenCount > 0 || done.length > 0) && <div className="small text-muted my-2">{text.optionalHint}</div>}
        {pending.map((quest) => {
          const open = isQuestOpen(quest.id, { openIds, busyQuestId, gpsBusyQuestId, gpsFeedback, activeQuestId })
          return open ? (
            <QuestCard
              key={quest.id}
              {...cardProps(quest)}
              completed={false}
              canComplete
              onCollapse={() => setOpenIds((ids) => toggled(ids, quest.id))}
              onViewMap={onViewMap && optionalHasOwnPlace(quest, core) ? () => onViewMap(mapFocusTarget({ quest })) : null}
            />
          ) : (
            <CompactQuestRow key={quest.id} quest={quest} progress={progressByQuestId?.get(quest.id) ?? null} onOpen={() => setOpenIds((ids) => toggled(ids, quest.id))} />
          )
        })}

        {/* 완료한 선택 퀘스트: 하나의 접힌 그룹 (기본 접힘) */}
        {done.length > 0 && (
          <div className="mb-2">
            <button type="button" className="quest-done-row" aria-expanded={groupOpen} onClick={() => setGroupOpen((open) => !open)}>
              <span>
                <span aria-hidden="true">✓</span> {layout.doneGroup(done.length)}
                {recentlyDone > 0 && (
                  <Badge bg="success" className="ms-1">
                    {layout.justDone}
                  </Badge>
                )}
              </span>
              <span className="quest-done-row__action">{groupOpen ? layout.collapse : layout.expand}</span>
            </button>
            {groupOpen && (
              <div className="mt-1">
                {done.map((quest) => (
                  <QuestCard key={quest.id} {...cardProps(quest)} completed canComplete={false} />
                ))}
              </div>
            )}
          </div>
        )}

        {hiddenCount > 0 && (
          <Button variant="outline-primary" size="sm" className="mb-2" disabled={disabled || revealing} onClick={() => onReveal(chapter)}>
            {revealing ? text.revealing : `${UI_TEXT.confirmed.moreQuests} (${text.hiddenLeft} ${hiddenCount})`}
          </Button>
        )}

        {preview}

        {/* 챕터 이동 버튼은 항상 1개. 상태에 따라 문구와 기능만 바뀐다. 모바일에서는 bottom nav 바로 위에 고정된다. (확인 모달은 기존 그대로) */}
        <div className="chapter-action-bar">
          <Button className="w-100" variant={advance.variant} disabled={disabled} onClick={advance.onClick}>
            {advance.label}
          </Button>
        </div>
      </Card.Body>
    </Card>
  )
}
