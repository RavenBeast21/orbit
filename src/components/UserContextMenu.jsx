import { useEffect, useRef } from 'react'

// Right-click context menu for a user, shown inside a server context
// (member sidebar, message list, voice channel, etc).
//
// Props:
//   x, y            - screen position to render the menu at (from the click event)
//   targetUser      - the user record this menu is about
//   isSelf          - true if targetUser is the logged-in user (hides irrelevant actions)
//   isFriend        - true if already friends (swaps "Add Friend" for a disabled/hidden state)
//   isBlocked       - true if already blocked (swaps label to "Unblock")
//   onClose         - called when the menu should close (click-away, action taken, Escape)
//   onProfile       - () => void
//   onMention       - () => void
//   onStartCall     - () => void
//   onInviteToServer - () => void
//   onAddFriend     - () => void
//   onBlock         - () => void
//
// Voice-only (optional) props — rendered only when supplied:
//   isLocallyMuted / onToggleLocalMute     - this viewer doesn't hear the user
//   isLocallyDeafened / onToggleLocalDeafen- same, for a specific user
//   canModerateVoice                        - show server mute/deafen actions
//   isServerMuted / onToggleServerMute
//   isServerDeafened / onToggleServerDeafen
function UserContextMenu({
  x,
  y,
  targetUser,
  isSelf,
  isFriend,
  isBlocked,
  onClose,
  onProfile,
  onMention,
  onStartCall,
  onInviteToServer,
  onAddFriend,
  onBlock,
  isLocallyMuted,
  onToggleLocalMute,
  isLocallyDeafened,
  onToggleLocalDeafen,
  canModerateVoice,
  isServerMuted,
  onToggleServerMute,
  isServerDeafened,
  onToggleServerDeafen,
}) {
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClickAway = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
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

  // Keep the menu on-screen if it was opened near the right/bottom edge.
  const style = {
    position: 'fixed',
    top: y,
    left: x,
  }

  const runAndClose = (action) => {
    if (action) action()
    onClose()
  }

  if (!targetUser) return null

  return (
    <div className="user-context-menu" ref={menuRef} style={style}>
      <button className="user-context-menu-item" onClick={() => runAndClose(onProfile)}>
        Profile
      </button>

      {!isSelf && onMention && (
        <button className="user-context-menu-item" onClick={() => runAndClose(onMention)}>
          Mention
        </button>
      )}

      {!isSelf && onStartCall && (
        <button className="user-context-menu-item" onClick={() => runAndClose(onStartCall)}>
          Start a Call
        </button>
      )}

      {!isSelf && onToggleLocalMute && (
        <button className="user-context-menu-item" onClick={() => runAndClose(onToggleLocalMute)}>
          {isLocallyMuted ? 'Unmute' : 'Mute'}{isLocallyMuted ? '  ✓' : ''}
        </button>
      )}

      {!isSelf && onToggleLocalDeafen && (
        <button className="user-context-menu-item" onClick={() => runAndClose(onToggleLocalDeafen)}>
          {isLocallyDeafened ? 'Undeafen' : 'Deafen'}{isLocallyDeafened ? '  ✓' : ''}
        </button>
      )}

      {onInviteToServer && !isSelf && (
        <button className="user-context-menu-item" onClick={() => runAndClose(onInviteToServer)}>
          Invite to Server
        </button>
      )}

      {!isSelf && !isFriend && (
        <button className="user-context-menu-item" onClick={() => runAndClose(onAddFriend)}>
          Add Friend
        </button>
      )}

      {canModerateVoice && (
        <>
          <div className="user-context-menu-divider" />
          <button
            className="user-context-menu-item user-context-menu-item-danger"
            onClick={() => runAndClose(onToggleServerMute)}
          >
            {isServerMuted ? 'Server Unmute' : 'Server Mute'}{isServerMuted ? '  ✓' : ''}
          </button>
          <button
            className="user-context-menu-item user-context-menu-item-danger"
            onClick={() => runAndClose(onToggleServerDeafen)}
          >
            {isServerDeafened ? 'Server Undeafen' : 'Server Deafen'}{isServerDeafened ? '  ✓' : ''}
          </button>
        </>
      )}

      {!isSelf && (
        <>
          <div className="user-context-menu-divider" />
          <button
            className="user-context-menu-item user-context-menu-item-danger"
            onClick={() => runAndClose(onBlock)}
          >
            {isBlocked ? 'Unblock' : 'Block'}
          </button>
        </>
      )}
    </div>
  )
}

export default UserContextMenu