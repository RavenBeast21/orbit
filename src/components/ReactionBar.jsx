import { useEffect, useRef, useState } from 'react'
import pb from '../pocketbase'
import EmojiPicker, { renderMessageContent } from './EmojiPicker'

// Reaction pills for one message, plus an add-reaction button whose picker
// opens directly above it.
function ReactionBar({ targetId, reactions = [], currentUserId, onToggle, emojiCache = {} }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState(null)
  const [localCache, setLocalCache] = useState({})
  const addBtnRef = useRef(null)

  // Custom server emojis used as reactions may not be in the parent's message
  // emoji cache — fetch any missing tokens so they render as images, not raw
  // :name:id: text.
  useEffect(() => {
    const tokenPattern = /:[^:\s]+:([a-zA-Z0-9]{15}):/g
    const ids = new Set()
    reactions.forEach((r) => {
      let m
      while ((m = tokenPattern.exec(r.emoji)) !== null) ids.add(m[1])
    })
    const missing = [...ids].filter((id) => !emojiCache[id] && !localCache[id])
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map((id) => pb.collection('emojis').getOne(id).catch(() => null)))
      .then((rows) => {
        if (cancelled) return
        const updates = {}
        rows.forEach((row, i) => { if (row) updates[missing[i]] = row })
        if (Object.keys(updates).length > 0) setLocalCache((prev) => ({ ...prev, ...updates }))
      })
    return () => { cancelled = true }
  }, [reactions, emojiCache, localCache])

  const cache = { ...emojiCache, ...localCache }

  const groups = {}
  reactions.forEach((r) => {
    if (!groups[r.emoji]) groups[r.emoji] = { emoji: r.emoji, count: 0, mine: false }
    groups[r.emoji].count += 1
    if (r.user === currentUserId) groups[r.emoji].mine = true
  })
  const list = Object.values(groups)

  const openPicker = () => {
    if (addBtnRef.current) setAnchorRect(addBtnRef.current.getBoundingClientRect())
    setPickerOpen(true)
  }

  return (
    <div className="reaction-bar">
      {list.map((g) => (
        <button
          key={g.emoji}
          type="button"
          className={`reaction-pill${g.mine ? ' reaction-pill-mine' : ''}`}
          onClick={() => onToggle(targetId, g.emoji, currentUserId)}
          title={g.mine ? 'Remove your reaction' : 'Add reaction'}
        >
          <span className="reaction-emoji">{renderMessageContent(g.emoji, cache)}</span>
          <span className="reaction-count">{g.count}</span>
        </button>
      ))}

      <button
        ref={addBtnRef}
        type="button"
        className="reaction-add"
        onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
        title="Add reaction"
      >
        <span className="reaction-add-plus">＋</span>
      </button>

      {pickerOpen && (
        <EmojiPicker
          currentUserId={currentUserId}
          anchorRect={anchorRect}
          onSelect={(value) => {
            onToggle(targetId, value, currentUserId)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

export default ReactionBar
