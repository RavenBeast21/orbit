import { useEffect, useRef, useState } from 'react'
import { formatDateTime } from '../formatting'

// Solid push pin (the reference the user supplied). The one deliberate
// exception to Orbit's stroke icons, because the reference is a solid pin.
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      <g transform="translate(12 12) rotate(45) scale(.88) translate(-12 -12)">
        <path d="M16 9V4l1 0c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1l1 0v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
      </g>
    </svg>
  )
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

// Reusable pinned-messages affordance: a pin icon + count badge in the topbar
// and a non-modal popover listing every pinned message. Rows reveal a "Jump"
// affordance on hover/focus (always visible on touch) and clicking the row
// jumps to the source message. Used by both server channels and DMs.
//
// items: [{ id, authorName, avatarUrl, content, created, fallbackInitial }]
function PinnedMessages({ items = [], loading = false, emptyHint, onJump, onUnpin }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const anchorRef = useRef(null)
  const buttonRef = useRef(null)
  const listRef = useRef(null)

  const count = items.length

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Move focus into the panel on open (first row, or the close button when
  // there is nothing to jump to). Non-modal, so focus is not trapped.
  useEffect(() => {
    if (!open) return
    const target = listRef.current?.querySelector('.pins-item-main')
      || anchorRef.current?.querySelector('.pins-panel-close')
    target?.focus()
  }, [open])

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  const handleJump = (id) => {
    setOpen(false)
    onJump?.(id)
  }

  const handleUnpin = async (id) => {
    setError('')
    try {
      await onUnpin?.(id)
    } catch (err) {
      console.error('Unpin message error:', err)
      setError("Couldn't unpin that message.")
    }
  }

  return (
    <div className="pins-anchor" ref={anchorRef}>
      <button
        ref={buttonRef}
        type="button"
        className="topbar-icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="Pinned messages"
        aria-label={count > 0 ? `Pinned messages, ${count}` : 'Pinned messages'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="pins-panel"
      >
        <PinIcon />
        {count > 0 && (
          <span className="topbar-icon-btn-badge">{count > 99 ? '99+' : count}</span>
        )}
      </button>

      {open && (
        <div className="pins-panel" id="pins-panel" role="dialog" aria-label="Pinned messages">
          <div className="pins-panel-head">
            <span className="pins-panel-title">Pinned Messages</span>
            {count > 0 && <span className="pins-panel-count">{count}</span>}
            <button type="button" className="pins-panel-close" onClick={close} aria-label="Close">
              <IconX />
            </button>
          </div>

          {error && <p className="pins-error">{error}</p>}

          <ul className="pins-list list-reset" ref={listRef} role="list">
            {loading && [0, 1, 2].map((i) => (
              <li className="pins-item pins-item--skeleton" key={i} aria-hidden="true">
                <span className="pins-skeleton-avatar" />
                <span className="pins-skeleton-lines">
                  <span className="pins-skeleton-bar pins-skeleton-bar--long" />
                  <span className="pins-skeleton-bar pins-skeleton-bar--short" />
                </span>
              </li>
            ))}

            {!loading && count === 0 && (
              <li className="pins-empty">
                <span className="pins-empty-icon"><PinIcon /></span>
                <div className="pins-empty-title">No pinned messages</div>
                <p className="pins-empty-body">{emptyHint}</p>
              </li>
            )}

            {!loading && items.map((item) => (
              <li className="pins-item" key={item.id}>
                <button
                  type="button"
                  className="pins-item-main"
                  onClick={() => handleJump(item.id)}
                  aria-label={`Jump to message from ${item.authorName || 'Unknown'}: ${(item.content || '').slice(0, 80)}`}
                >
                  {item.avatarUrl ? (
                    <img src={item.avatarUrl} alt="" className="pins-item-avatar" />
                  ) : (
                    <span className="pins-item-avatar pins-item-avatar--fallback">
                      {(item.authorName || '?').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="pins-item-body">
                    <span className="pins-item-head">
                      <span className="pins-item-author">{item.authorName || 'Unknown'}</span>
                      {item.created && <span className="pins-item-time">{formatDateTime(item.created)}</span>}
                    </span>
                    <span className="pins-item-preview">{item.content || 'Attachment'}</span>
                  </span>
                </button>

                <span className="pins-item-actions">
                  <span className="pins-item-jump" aria-hidden="true">
                    Jump <IconChevronRight />
                  </span>
                  {onUnpin && (
                    <button
                      type="button"
                      className="pins-item-unpin"
                      title="Unpin"
                      aria-label={`Unpin message from ${item.authorName || 'Unknown'}`}
                      onClick={() => handleUnpin(item.id)}
                    >
                      <IconX />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default PinnedMessages
