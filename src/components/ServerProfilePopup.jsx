import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import pb from '../pocketbase'
import { resolveBanner, canViewFullProfile, activityVisibleTo } from '../profileUtils'
import SubscriptionBadge from './SubscriptionBadge'

// Small server-scoped profile card, shown on left-click of a user anywhere
// inside a server. Falls back to the user's global bio/avatar/banner if
// they haven't set a per-server profile (or left individual fields blank).
//
// Props:
//   x, y            - anchor position (from the click event)
//   targetUserId    - id of the user this popup is about
//   serverId        - server this popup is scoped to
//   onClose         - called on click-away / Escape
//   onViewFullProfile - () => void, opens FullProfileModal for this user
//   onMessage       - () => void, opens/starts a DM with this user
function ServerProfilePopup({ x, y, targetUserId, serverId, onClose, onViewFullProfile, onMessage }) {
  const popupRef = useRef(null)
  const [user, setUser] = useState(null)
  const [serverProfile, setServerProfile] = useState(null)
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [canSeeFull, setCanSeeFull] = useState(true)
  const [activity, setActivity] = useState('')

  useEffect(() => {
    const handleClickAway = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose()
    }
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickAway)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickAway)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  useEffect(() => {
    if (!targetUserId || !serverId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const userRecord = await pb.collection('users').getOne(targetUserId)
        if (cancelled) return
        setUser(userRecord)

        const allowed = await canViewFullProfile(pb.authStore.model?.id, userRecord)
        if (!cancelled) setCanSeeFull(allowed)

        const showActivity = await activityVisibleTo(userRecord, pb.authStore.model?.id)
        if (!cancelled) setActivity(showActivity ? (userRecord.custom_activity || '') : '')

        try {
          const profiles = await pb.collection('server_profiles').getFullList({
            filter: `server="${serverId}" && user="${targetUserId}"`,
            requestKey: null,
          })
          if (!cancelled) setServerProfile(profiles[0] || null)
        } catch (err) {
          console.error('Load server profile error:', err)
        }

        try {
          const memberRecords = await pb.collection('members').getFullList({
            filter: `server="${serverId}" && user="${targetUserId}"`,
            requestKey: null,
          })
          const member = memberRecords[0]
          if (member) {
            const links = await pb.collection('member_roles').getFullList({
              filter: `member="${member.id}"`,
              expand: 'role',
              requestKey: null,
            })
            if (!cancelled) {
              const roleRecords = links
                .map((l) => l.expand?.role)
                .filter(Boolean)
                .sort((a, b) => b.position - a.position)
              setRoles(roleRecords)
            }
          }
        } catch (err) {
          console.error('Load member roles error:', err)
        }
      } catch (err) {
        console.error('Load user error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [targetUserId, serverId])

  // The popup is anchored to the click point, which can be anywhere — often
  // near the right edge (the member list) or the bottom. Clamp it back inside
  // the viewport (and re-clamp as its content loads/grows) so it is always
  // fully on screen. Done imperatively to avoid a state-update-in-effect and
  // because the anchor rarely changes while it is open.
  useLayoutEffect(() => {
    const el = popupRef.current
    if (!el) return
    const clamp = () => {
      const margin = 8
      // Never let the card itself be wider/taller than the viewport (narrow
      // windows / small screens), then clamp its position into the remainder.
      el.style.maxWidth = `${Math.max(200, window.innerWidth - margin * 2)}px`
      el.style.maxHeight = `${Math.max(200, window.innerHeight - margin * 2)}px`
      el.style.overflowY = 'auto'
      const rect = el.getBoundingClientRect()
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)
      el.style.left = `${Math.min(Math.max(margin, x), maxLeft)}px`
      el.style.top = `${Math.min(Math.max(margin, y), maxTop)}px`
    }
    clamp()
    let observer
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(clamp)
      observer.observe(el)
    }
    window.addEventListener('resize', clamp)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', clamp)
    }
  }, [x, y, loading, user, roles, serverProfile])

  if (!targetUserId) return null

  const displayName = serverProfile?.nickname || user?.name || 'Unknown'
  const username = user?.username
  const bio = serverProfile?.bio || user?.bio || ''
  const avatarUrl = serverProfile?.avatar
    ? pb.files.getURL(serverProfile, serverProfile.avatar, { thumb: '80x80' })
    : (user?.avatar ? pb.files.getURL(user, user.avatar, { thumb: '80x80' }) : null)

  // Per-server banner falls back to the user's global banner if they
  // haven't set one for this specific server.
  const bannerSource = resolveBanner(serverProfile)
  const banner = bannerSource.type !== 'none' ? bannerSource : resolveBanner(user)

  const style = { position: 'fixed', top: y, left: x }

  return (
    <div className="server-profile-popup" ref={popupRef} style={style}>
      {loading ? (
        <div className="server-profile-popup-loading">Loading...</div>
      ) : (
        <>
          <div
            className="server-profile-popup-banner"
            style={
              banner.type === 'image'
                ? { backgroundImage: `url(${banner.value})` }
                : banner.type === 'colour'
                ? { backgroundColor: banner.value }
                : undefined
            }
          />

          <div className="server-profile-popup-avatar-wrap">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="server-profile-popup-avatar" />
            ) : (
              <div className="server-profile-popup-avatar server-profile-popup-avatar-fallback" />
            )}
          </div>

          <div className="server-profile-popup-body">
            <div className="server-profile-popup-name">
              {displayName}
              <SubscriptionBadge user={user} />
            </div>
            {username && <div className="server-profile-popup-username">{username}</div>}

            {activity && (
              <div style={{ color: 'var(--text)', margin: '6px 0 0' }}>🎮 {activity}</div>
            )}

            {canSeeFull ? (
              bio && <div className="server-profile-popup-bio">{bio}</div>
            ) : (
              <div className="server-profile-popup-bio" style={{ color: 'var(--text)', fontStyle: 'italic' }}>
                Full profile is private
              </div>
            )}

            {roles.length > 0 && (
              <div className="server-profile-popup-roles">
                {roles.map((role) => (
                  <span
                    key={role.id}
                    className="server-profile-popup-role-pill"
                    style={role.colour ? { borderColor: role.colour, color: role.colour } : undefined}
                  >
                    {role.name}
                  </span>
                ))}
              </div>
            )}

            <div className="server-profile-popup-actions">
              <button className="btn-secondary" onClick={onMessage}>Message</button>
              <button className="btn-secondary" onClick={onViewFullProfile}>View Full Profile</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ServerProfilePopup