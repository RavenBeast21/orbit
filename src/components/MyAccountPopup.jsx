import { useState, useEffect, useRef } from 'react'
import pb from '../pocketbase'
import { resolveBanner } from '../profileUtils'
import ProfileEditor from './ProfileEditor'
import SubscriptionBadge from './SubscriptionBadge'

function statusColor(status) {
  if (status === 'idle') return 'var(--warning)'
  if (status === 'dnd') return 'var(--danger)'
  if (status === 'offline' || status === 'invisible') return 'var(--border)'
  return 'var(--teal)'
}

// Order matters — this is the exact top-to-bottom order requested:
// Online, Idle, Dnd, Invisible. Online has no duration sub-flyout (it's
// not a "temporary until X" state the way the other three are).
const STATUS_OPTIONS = [
  { value: 'online', label: 'Online', hasDuration: false },
  { value: 'idle', label: 'Idle', hasDuration: true },
  { value: 'dnd', label: 'Do Not Disturb', hasDuration: true },
  { value: 'invisible', label: 'Invisible', hasDuration: true },
]

const DURATION_OPTIONS = [
  { value: 15 * 60 * 1000, label: 'For 15 Minutes' },
  { value: 60 * 60 * 1000, label: 'For 1 Hour' },
  { value: 8 * 60 * 60 * 1000, label: 'For 8 Hours' },
  { value: 24 * 60 * 60 * 1000, label: 'For 24 Hours' },
  { value: 3 * 24 * 60 * 60 * 1000, label: 'For 3 Days' },
  { value: null, label: 'Forever' },
]

// Popup opened by clicking your OWN avatar/name in HomeSidebar's user
// panel (not Settings, not Logout). Shows a mini version of your own
// profile plus the status picker in one place — Discord's "click your
// own tag" popup.
//
// Props:
//   anchorRef   - ref of the element that was clicked, used to position
//                 the popup just above it
//   onClose     - called on click-away / Escape
function MyAccountPopup({ anchorRef, onClose }) {
  const popupRef = useRef(null)
  const me = pb.authStore.model
  const [myStatus, setMyStatus] = useState(me?.status || 'online')
  const [statusSaving, setStatusSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  // One-time explicit status share (report §4.9): a deliberate broadcast that
  // is distinct from the passive "notify on status change" preference.
  const [sharingStatus, setSharingStatus] = useState(false)
  const [shareNote, setShareNote] = useState('')

  const handleShareStatus = async () => {
    setSharingStatus(true)
    setShareNote('')
    try {
      const now = new Date().toISOString()
      await pb.collection('users').update(me.id, { status_shared_at: now }, { requestKey: null })
      setShareNote('Shared')
      setTimeout(() => setShareNote(''), 2500)
    } catch (err) {
      console.error('Share status error:', err)
      setShareNote('Could not share')
    } finally {
      setSharingStatus(false)
    }
  }

  // Status flyout is hover-driven, matching the reference — opens to the
  // RIGHT of the trigger row, touching it (no gap) so it reads as one
  // connected menu rather than two separate popups. hoveredOption tracks
  // which status row is currently hovered, which in turn decides whether
  // a duration flyout opens even further right.
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [hoveredOption, setHoveredOption] = useState(null)
  const [flyoutOpenUpward, setFlyoutOpenUpward] = useState(false)
  const statusPickerRef = useRef(null)
  const statusMenuCloseTimer = useRef(null)

  // Avatar hover — shows a transparent pencil overlay on hover, opens a
  // small Change/Remove Avatar menu on click.
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const avatarFileInputRef = useRef(null)
  const [avatarSaving, setAvatarSaving] = useState(false)

  useEffect(() => {
    const handleClickAway = (e) => {
      if (editorOpen) return // ProfileEditor is portaled outside popupRef — handles its own close
      // Ignore the trigger itself: without this, mousedown on the avatar/name
      // closes the popup and the following click immediately reopens it.
      const onTrigger = anchorRef?.current?.contains(e.target)
      if (popupRef.current && !popupRef.current.contains(e.target) && !onTrigger) onClose()
    }
    const handleEscape = (e) => {
      if (editorOpen) return
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickAway)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickAway)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, editorOpen, anchorRef])

  // Small delay before closing on mouse-leave so moving the cursor
  // diagonally from the trigger into the flyout (or from the status row
  // into its duration flyout) doesn't slam the menu shut mid-move.
  const cancelCloseTimer = () => {
    if (statusMenuCloseTimer.current) {
      clearTimeout(statusMenuCloseTimer.current)
      statusMenuCloseTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelCloseTimer()
    statusMenuCloseTimer.current = setTimeout(() => {
      setStatusMenuOpen(false)
      setHoveredOption(null)
    }, 200)
  }

  const applyStatus = async (value) => {
    if (value === myStatus) return
    const previous = myStatus
    setMyStatus(value) // instant feedback
    setStatusSaving(true)
    try {
      await pb.collection('users').update(me.id, { status: value }, { requestKey: null })
      if (pb.authStore.model) pb.authStore.model.status = value
    } catch (err) {
      console.error('Update status error:', err)
      setMyStatus(previous) // revert on failure
    } finally {
      setStatusSaving(false)
    }
  }

  // Online has no duration step — picking it applies immediately and
  // closes the whole flyout. Idle/Dnd/Invisible open the duration
  // sub-flyout instead of applying right away (handled by hover, this
  // just covers a direct click before the sub-flyout is reachable, e.g.
  // touch/keyboard use).
  const handlePickStatus = (opt) => {
    if (!opt.hasDuration) {
      applyStatus(opt.value)
      setStatusMenuOpen(false)
      setHoveredOption(null)
    }
    // hasDuration options: do nothing on click itself, the duration
    // flyout (opened via hover) is where the actual pick happens.
  }

  const handlePickDuration = async (statusValue, durationMs) => {
    await applyStatus(statusValue)
    // Duration itself isn't persisted anywhere yet — there's no
    // status_expires_at field on users yet, so "For 15 Minutes" etc
    // currently just sets the status with no auto-revert. Flagged as a
    // follow-up rather than silently pretending it schedules something.
    setStatusMenuOpen(false)
    setHoveredOption(null)
  }

  const handleChangeAvatarClick = () => {
    setAvatarMenuOpen(false)
    avatarFileInputRef.current?.click()
  }

  const handleAvatarFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarSaving(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)
      const updated = await pb.collection('users').update(me.id, formData)
      if (pb.authStore.model) Object.assign(pb.authStore.model, updated)
    } catch (err) {
      console.error('Change avatar error:', err)
    } finally {
      setAvatarSaving(false)
      e.target.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    setAvatarMenuOpen(false)
    setAvatarSaving(true)
    try {
      const updated = await pb.collection('users').update(me.id, { avatar: null })
      if (pb.authStore.model) Object.assign(pb.authStore.model, updated)
    } catch (err) {
      console.error('Remove avatar error:', err)
    } finally {
      setAvatarSaving(false)
    }
  }

  if (!me) return null

  const banner = resolveBanner(me)
  const avatarUrl = me.avatar ? pb.files.getURL(me, me.avatar, { thumb: '80x80' }) : null

  // Position just above the clicked element, matching the panel it's
  // anchored to (HomeSidebar's user panel sits at the bottom of a
  // narrow left rail, so this opens upward like Discord's does).
  const anchorRect = anchorRef?.current?.getBoundingClientRect()
  const style = anchorRect
    ? { position: 'fixed', left: anchorRect.left, bottom: window.innerHeight - anchorRect.top + 8 }
    : { position: 'fixed', left: 16, bottom: 80 }

  return (
    <div className="my-account-popup" ref={popupRef} style={style}>
      <div
        className="my-account-popup-banner"
        style={
          banner.type === 'image'
            ? { backgroundImage: `url(${banner.value})` }
            : banner.type === 'colour'
            ? { backgroundColor: banner.value }
            : undefined
        }
      />

      <div className="my-account-popup-avatar-wrap">
        <div className="my-account-popup-avatar-hover-target">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="my-account-popup-avatar" />
          ) : (
            <div className="my-account-popup-avatar my-account-popup-avatar-fallback" />
          )}
          <button
            type="button"
            className="my-account-popup-avatar-edit-btn"
            onClick={() => setAvatarMenuOpen((v) => !v)}
            title="Edit avatar"
          >
            ✏️
          </button>
        </div>
        <span
          className="my-account-popup-status-dot"
          style={{ backgroundColor: statusColor(myStatus) }}
        />

        <input
          ref={avatarFileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleAvatarFileChange}
        />

        {avatarMenuOpen && (
          <div className="my-account-popup-avatar-menu">
            <button className="user-context-menu-item" onClick={handleChangeAvatarClick} disabled={avatarSaving}>
              Change Avatar
            </button>
            <button
              className="user-context-menu-item user-context-menu-item-danger"
              onClick={handleRemoveAvatar}
              disabled={avatarSaving || !me.avatar}
            >
              Remove Avatar
            </button>
          </div>
        )}
      </div>

      <div className="my-account-popup-body">
        <div className="my-account-popup-name">
          {me.name}
          <SubscriptionBadge user={me} />
        </div>
        {me.username && <div className="my-account-popup-username">{me.username}</div>}
        {me.show_activity && me.custom_activity && (
          <div style={{ color: 'var(--text)', margin: '6px 0 0' }}>🎮 {me.custom_activity}</div>
        )}

        {me.bio && <div className="my-account-popup-bio">{me.bio}</div>}

        <button className="btn-primary my-account-popup-edit-btn" onClick={() => setEditorOpen(true)}>
          ✏️ Edit Profile
        </button>

        <div
          ref={statusPickerRef}
          className="my-account-popup-status-picker"
          onMouseEnter={() => {
            cancelCloseTimer()
            // Rough flyout height: 4 rows (~38px each) + 12px padding.
            // If there isn't room below the trigger for that, open the
            // flyout upward instead so it can't run off the bottom of
            // the screen (this popup itself opens near the bottom-left
            // of the window, so the flyout running out of room below is
            // the common case, not the exception).
            const rect = statusPickerRef.current?.getBoundingClientRect()
            const estimatedFlyoutHeight = 4 * 38 + 12
            setFlyoutOpenUpward(!!rect && rect.top + estimatedFlyoutHeight > window.innerHeight)
            setStatusMenuOpen(true)
          }}
          onMouseLeave={scheduleClose}
        >
          <button
            className="my-account-popup-status-trigger"
            onClick={() => {
              const rect = statusPickerRef.current?.getBoundingClientRect()
              const estimatedFlyoutHeight = 4 * 38 + 12
              setFlyoutOpenUpward(!!rect && rect.top + estimatedFlyoutHeight > window.innerHeight)
              setStatusMenuOpen((v) => !v)
            }}
          >
            <span className="my-account-popup-status-dot-inline" style={{ backgroundColor: statusColor(myStatus) }} />
            {statusSaving ? 'Saving...' : (STATUS_OPTIONS.find((o) => o.value === myStatus)?.label || myStatus)}
            <span style={{ marginLeft: 'auto' }}>›</span>
          </button>

          {statusMenuOpen && (
            <div
              className={`my-account-popup-status-flyout${flyoutOpenUpward ? ' opens-upward' : ''}`}
              onMouseEnter={cancelCloseTimer}
              onMouseLeave={scheduleClose}
            >
              {STATUS_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  className="my-account-popup-status-flyout-row"
                  onMouseEnter={() => setHoveredOption(opt.value)}
                >
                  <button
                    className="my-account-popup-status-menu-item"
                    onClick={() => handlePickStatus(opt)}
                  >
                    <span className="home-sidebar-status-menu-dot" style={{ backgroundColor: statusColor(opt.value) }} />
                    {opt.label}
                    {opt.hasDuration && <span style={{ marginLeft: 'auto' }}>›</span>}
                  </button>

                  {opt.hasDuration && hoveredOption === opt.value && (
                    <div className={`my-account-popup-duration-flyout${flyoutOpenUpward ? ' opens-upward' : ''}`}>
                      {DURATION_OPTIONS.map((d) => (
                        <button
                          key={d.label}
                          className="my-account-popup-status-menu-item"
                          onClick={() => handlePickDuration(opt.value, d.value)}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          className="my-account-popup-share-btn"
          onClick={handleShareStatus}
          disabled={sharingStatus}
          title="Send a one-time status update to the audience you chose in Settings"
          style={{ marginTop: '8px' }}
        >
          {sharingStatus ? 'Sharing...' : '📣 Share status update'}
        </button>
        {shareNote && <p style={{ margin: '4px 0 0', color: shareNote === 'Shared' ? 'var(--teal)' : 'var(--danger)', fontSize: '0.85em' }}>{shareNote}</p>}

        {/* Switch Accounts — deferred until multi-account support exists */}
      </div>

      {editorOpen && (
        <ProfileEditor onClose={() => { setEditorOpen(false); onClose() }} />
      )}
    </div>
  )
}

export default MyAccountPopup