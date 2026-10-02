import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import { getTextBlockReason, isBurstMessage } from '../contentFilters'

// Viewer-side text guards, shared by server channels and DMs.
//
// SpamFilteredText hides a message behind a click-to-reveal button when the
// VIEWER's own spam filters flag it (a link from a non-friend, or one of
// their blocked keywords). getTextBlockReason is async (it may need a
// friends lookup), so this is a small component rather than inline logic.
export function SpamFilteredText({ senderId, text, children }) {
  const [reason, setReason] = useState(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getTextBlockReason(senderId, text).then((r) => { if (!cancelled) setReason(r) })
    return () => { cancelled = true }
  }, [senderId, text])

  if (reason && !revealed) {
    return (
      <button
        type="button"
        className="dm-link-block-btn"
        onClick={() => setRevealed(true)}
      >
        {reason === 'link'
          ? '⚠️ Message contains a link from a non-friend — click to view'
          : '⚠️ Message hidden by your keyword filter — click to view'}
      </button>
    )
  }

  return children
}

// Viewer-side burst collapsing for spam_filter_rate_limit. Purely opt-in and
// display-only; the real anti-spam throttle is server-side.
export function BurstGuard({ messages, index, children }) {
  const [revealed, setRevealed] = useState(false)
  const me = pb.authStore.model

  if (!me?.spam_filter_rate_limit) return children
  if (revealed) return children
  if (!isBurstMessage(messages, index)) return children

  return (
    <button
      type="button"
      className="dm-link-block-btn"
      onClick={() => setRevealed(true)}
    >
      ⚠️ Rapid messages hidden by your spam filter — click to show
    </button>
  )
}
