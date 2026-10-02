import { useState, useRef } from 'react'
import pb from '../pocketbase'
import MyAccountPopup from './MyAccountPopup'
import { useVoiceState, toggleMute, toggleDeafen } from '../voiceState'

function statusLabel(status) {
  if (status === 'idle') return 'Idle'
  if (status === 'dnd') return 'Do Not Disturb'
  if (status === 'invisible') return 'Invisible'
  if (status === 'offline') return 'Offline'
  return 'Online'
}

// Only the five real presence values are meaningful; anything else (undefined,
// a future value) is treated as plain online, matching the old default colour.
function normalizedStatus(status) {
  if (status === 'idle' || status === 'dnd' || status === 'offline' || status === 'invisible') return status
  return 'online'
}

// First letter of the first two words, so "Ahmed Khan" -> "AK" and "orbit" ->
// "O". Array.from keeps emoji/surrogate pairs from being sliced in half.
function initialsFor(user) {
  const source = (user?.name && user.name.trim()) || user?.username || ''
  const words = source.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] || '')
    .filter(Boolean)
    .join('')
    .toUpperCase()
}

// --- Icons (inline SVG so they follow currentColor on every OS) ---

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  )
}

function IconMicOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
      <path d="m3 3 18 18" />
    </svg>
  )
}

function IconHeadphones() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  )
}

function IconHeadphonesOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      <path d="m3 3 18 18" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// Always-visible account strip (bottom of the Home sidebar AND the in-server
// channel sidebar). The avatar + name is one button that opens the account
// popup; mute, deafen and settings sit in a control group on the right.
// Logging out lives in Settings itself, not here.
function UserPanel({ onOpenSettings }) {
  const me = pb.authStore.model
  const { muted, deafened } = useVoiceState()
  const [accountPopupOpen, setAccountPopupOpen] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)
  const panelRef = useRef(null)

  if (!me) {
    return (
      <div className="user-panel">
        <div className="user-panel-skeleton" aria-hidden="true">
          <span className="user-panel-skeleton-disc" />
          <span className="user-panel-skeleton-lines">
            <span className="user-panel-skeleton-bar user-panel-skeleton-bar--long" />
            <span className="user-panel-skeleton-bar user-panel-skeleton-bar--short" />
          </span>
        </div>
      </div>
    )
  }

  const displayName = (me.name && me.name.trim()) || me.username || 'Unknown'
  const hasDisplayName = !!(me.name && me.name.trim())
  const status = normalizedStatus(me.status)
  const initials = initialsFor(me)

  // toggleMute also un-deafens, so when deafened the next action is "Undeafen".
  const micTitle = deafened ? 'Undeafen' : muted ? 'Unmute' : 'Mute'
  const deafenTitle = deafened ? 'Undeafen' : 'Deafen'
  const profileTitle = hasDisplayName && me.username
    ? `${me.name}\n@${me.username}`
    : me.username
      ? `@${me.username}`
      : displayName

  return (
    <>
      <div className="user-panel" ref={panelRef}>
        <button
          type="button"
          className="user-panel-profile"
          onClick={() => setAccountPopupOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={accountPopupOpen}
          aria-label={`Account, ${displayName}, ${statusLabel(status)}`}
          title={profileTitle}
        >
          <span className="user-panel-avatar">
            {me.avatar && !imgBroken ? (
              <img
                src={pb.files.getURL(me, me.avatar, { thumb: '64x64' })}
                alt=""
                onError={() => setImgBroken(true)}
              />
            ) : (
              <span className="user-panel-initials" aria-hidden="true">{initials}</span>
            )}
            <span className="user-panel-presence" data-status={status} aria-hidden="true" />
          </span>
          <span className="user-panel-text">
            <span className="user-panel-name">{displayName}</span>
            <span className="user-panel-status">{statusLabel(status)}</span>
          </span>
        </button>

        <div className="user-panel-controls" role="group" aria-label="Voice and settings">
          <button
            type="button"
            className={`user-panel-btn${muted ? ' is-active' : ''}`}
            onClick={toggleMute}
            title={micTitle}
            aria-label="Mute"
            aria-pressed={muted}
          >
            {muted ? <IconMicOff /> : <IconMic />}
          </button>
          <button
            type="button"
            className={`user-panel-btn${deafened ? ' is-active' : ''}`}
            onClick={toggleDeafen}
            title={deafenTitle}
            aria-label="Deafen"
            aria-pressed={deafened}
          >
            {deafened ? <IconHeadphonesOff /> : <IconHeadphones />}
          </button>
          <button
            type="button"
            className="user-panel-btn"
            onClick={onOpenSettings}
            title="User Settings"
            aria-label="User Settings"
          >
            <IconGear />
          </button>
        </div>
      </div>

      {accountPopupOpen && (
        <MyAccountPopup
          anchorRef={panelRef}
          onClose={() => setAccountPopupOpen(false)}
          onEditProfile={() => {
            setAccountPopupOpen(false)
            onOpenSettings()
          }}
        />
      )}
    </>
  )
}

export default UserPanel
