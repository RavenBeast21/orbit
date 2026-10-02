import { useState, useEffect, useRef } from 'react'
import pb from '../pocketbase'
import { resolveBanner, formatMemberSince, canViewFullProfile, getMutualServers, activityVisibleTo } from '../profileUtils'
import SubscriptionBadge from './SubscriptionBadge'

// Full (global, not server-scoped) profile modal. Opened via "Profile" from
// UserContextMenu, or "View Full Profile" from ServerProfilePopup.
//
// Props:
//   targetUserId       - id of the user this modal is about
//   serverId           - server we were opened from, if any (needed for the
//                         "View Per-Server Profile" option in the ... menu;
//                         that option is hidden if this is null)
//   onClose            - called to close the modal entirely
//   onViewPerServerProfile - () => void
//   onInviteToServer   - () => void
//   onBlock            - () => void
//   onReport           - () => void
//   onMessage          - () => void
//   isBlocked          - true if already blocked (relabels the menu item)
function FullProfileModal({
  targetUserId,
  serverId,
  onClose,
  onViewPerServerProfile,
  onInviteToServer,
  onBlock,
  onReport,
  onMessage,
  isBlocked,
}) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const [canSeeFull, setCanSeeFull] = useState(true)
  const [mutual, setMutual] = useState({ allowed: true, servers: [] })
  const [activity, setActivity] = useState('')

  useEffect(() => {
    if (!targetUserId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const record = await pb.collection('users').getOne(targetUserId)
        if (cancelled) return
        setUser(record)
        const allowed = await canViewFullProfile(pb.authStore.model?.id, record)
        if (!cancelled) setCanSeeFull(allowed)

        const mutualResult = await getMutualServers(pb.authStore.model?.id, record)
        if (!cancelled) setMutual(mutualResult)

        const showActivity = await activityVisibleTo(record, pb.authStore.model?.id)
        if (!cancelled) setActivity(showActivity ? (record.custom_activity || '') : '')
      } catch (err) {
        console.error('Load user error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [targetUserId])

  useEffect(() => {
    const handleClickAway = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [])

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  if (!targetUserId) return null

  const banner = user ? resolveBanner(user) : { type: 'none', value: null }
  const avatarUrl = user?.avatar ? pb.files.getURL(user, user.avatar, { thumb: '160x160' }) : null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="full-profile-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        {loading || !user ? (
          <div className="full-profile-modal-loading">Loading...</div>
        ) : (
          <>
            <div
              className="full-profile-modal-banner"
              style={
                banner.type === 'image'
                  ? { backgroundImage: `url(${banner.value})` }
                  : banner.type === 'colour'
                  ? { backgroundColor: banner.value }
                  : undefined
              }
            />

            <div className="full-profile-modal-header">
              <div className="full-profile-modal-avatar-wrap">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="full-profile-modal-avatar" />
                ) : (
                  <div className="full-profile-modal-avatar full-profile-modal-avatar-fallback" />
                )}
              </div>

              <div className="full-profile-modal-menu-wrap" ref={menuRef}>
                <button className="full-profile-modal-menu-trigger" onClick={() => setMenuOpen((v) => !v)}>
                  •••
                </button>
                {menuOpen && (
                  <div className="full-profile-modal-menu">
                    {serverId && (
                      <button
                        className="user-context-menu-item"
                        onClick={() => { setMenuOpen(false); onViewPerServerProfile?.() }}
                      >
                        View Per-Server Profile
                      </button>
                    )}
                    {serverId && (
                      <button
                        className="user-context-menu-item"
                        onClick={() => { setMenuOpen(false); onInviteToServer?.() }}
                      >
                        Invite to Server
                      </button>
                    )}
                    <div className="user-context-menu-divider" />
                    <button
                      className="user-context-menu-item user-context-menu-item-danger"
                      onClick={() => { setMenuOpen(false); onBlock?.() }}
                    >
                      {isBlocked ? 'Unblock' : 'Block'}
                    </button>
                    <button
                      className="user-context-menu-item user-context-menu-item-danger"
                      onClick={() => { setMenuOpen(false); onReport?.() }}
                    >
                      Report User Profile
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="full-profile-modal-body">
              <div className="full-profile-modal-name">
                {user.name || 'Unknown'}
                <SubscriptionBadge user={user} />
              </div>
              {user.username && <div className="full-profile-modal-username">{user.username}</div>}

              {activity && (
                <div style={{ color: 'var(--text)', margin: '6px 0 0' }}>🎮 {activity}</div>
              )}

              {canSeeFull ? (
                user.bio && (
                  <div className="full-profile-modal-section">
                    <div className="full-profile-modal-section-label">About Me</div>
                    <div className="full-profile-modal-bio">{user.bio}</div>
                  </div>
                )
              ) : (
                <div className="full-profile-modal-section full-profile-modal-private-notice">
                  <div className="full-profile-modal-section-label">Private Profile</div>
                  <div style={{ color: 'var(--text)' }}>
                    {user.name || 'This user'} limits who can see their full profile. You're not on their list.
                  </div>
                </div>
              )}

              <div className="full-profile-modal-section">
                <div className="full-profile-modal-section-label">Member Since</div>
                <div>{formatMemberSince(user.created)}</div>
              </div>

              {(mutual.servers.length > 0 || !mutual.allowed) && (
                <div className="full-profile-modal-section">
                  <div className="full-profile-modal-section-label">Servers You Have in Common</div>
                  {mutual.allowed ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {mutual.servers.map((s) => (
                        <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {s.icon ? (
                            <img
                              src={pb.files.getURL(s, s.icon, { thumb: '24x24' })}
                              alt=""
                              style={{ width: '24px', height: '24px', borderRadius: '6px', objectFit: 'cover' }}
                            />
                          ) : (
                            <span style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'var(--surface-2)', display: 'inline-block' }} />
                          )}
                          {s.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text)' }}>
                      {user.name || 'This user'} has chosen not to show the servers you have in common.
                    </div>
                  )}
                </div>
              )}

              <div className="full-profile-modal-actions">
                <button className="btn-primary" onClick={onMessage}>Message</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default FullProfileModal