import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent } from 'livekit-client'
import pb from '../pocketbase'
import { TOKEN_SERVER_URL } from '../config'
import MembersSidebar from './MembersSidebar'
import UserContextMenu from './UserContextMenu'
import ServerProfilePopup from './ServerProfilePopup'
import FullProfileModal from './FullProfileModal'
import InviteToServerModal from './InviteToServerModal'
import { useVoiceState, toggleMute, toggleDeafen } from '../voiceState'

function VoiceChannel({ channel, server, canMuteMembers, onBack, members, ownerName, ownerStatus, ownerAvatarUrl, ownerLastSeen, ownerId, showOfflineMembers, onStartCallWithUser, onMessageUser }) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  // Self mute/deafen now live in the shared voice store so the always-visible
  // user panel and this view stay in sync.
  const { muted: selfMuted, deafened: selfDeafened } = useVoiceState()
  const [cameraOn, setCameraOn] = useState(false)
  // Remote participants as { identity, name } — identity is the real user id
  // (see server.js's AccessToken identity), which is what the profile UI
  // needs to open a user's card/context menu. Display name is separate.
  const [participants, setParticipants] = useState([])
  const [error, setError] = useState('')
  // True when a moderator has server-muted / server-deafened the local user.
  // The token server grants canPublish/canSubscribe:false in these states.
  const [serverMuted, setServerMuted] = useState(false)
  const [serverDeafened, setServerDeafened] = useState(false)

  // Effective state = my own choice OR a moderator's. Used for UI + mic.
  const muted = selfMuted || serverMuted || serverDeafened
  const deafened = selfDeafened || serverDeafened

  // Per-viewer LOCAL controls (never sent to the server):
  //   localMutedIds    - conversations I've chosen not to hear
  //   localDeafenedIds - same "don't hear" effect for a specific user
  const [localMutedIds, setLocalMutedIds] = useState(new Set())
  const [localDeafenedIds, setLocalDeafenedIds] = useState(new Set())

  // Profile UI state, mirroring ChannelView.jsx so a user is right-clickable
  // from inside a voice channel exactly like they are in a text channel.
  const [contextMenu, setContextMenu] = useState(null) // { x, y, userId, isSelf }
  const [serverPopup, setServerPopup] = useState(null) // { x, y, userId }
  const [fullProfileUserId, setFullProfileUserId] = useState(null)
  const [inviteTargetUserId, setInviteTargetUserId] = useState(null)
  const [blockedUserIds, setBlockedUserIds] = useState(new Set())
  const [friendUserIds, setFriendUserIds] = useState(new Set())
  const myUid = pb.authStore.model?.id

  const roomRef = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideosRef = useRef(null)

  // LiveKit event handlers are registered once, so they must read the CURRENT
  // deafen/local-mute state from refs rather than a stale closure.
  const deafenedRef = useRef(false)
  const localMutedRef = useRef(new Set())
  const localDeafenedRef = useRef(new Set())

  // Applies self-deafen + per-user local mute/deafen to the attached remote
  // audio elements. Purely client-side — the other user is unaffected.
  const applyAudioFilters = () => {
    document.querySelectorAll('[data-participant]').forEach((el) => {
      const pid = el.getAttribute('data-participant')
      el.muted =
        deafenedRef.current ||
        localMutedRef.current.has(pid) ||
        localDeafenedRef.current.has(pid)
    })
  }

  // Apply the shared mute/deafen state to the active LiveKit room, so the
  // always-visible user panel controls work while connected.
  useEffect(() => {
    const room = roomRef.current
    if (!room || !connected) return
    room.localParticipant.setMicrophoneEnabled(!muted).catch(() => {})
  }, [muted, connected])

  useEffect(() => {
    deafenedRef.current = deafened
    applyAudioFilters()
  }, [deafened, localMutedIds, localDeafenedIds])

  // The member record (with voice_muted / voice_deafened) for a given user,
  // fed down from ServerView's live members subscription.
  const memberFor = (userId) => members?.find((m) => m.user === userId)
  const isServerMuted = (userId) => !!memberFor(userId)?.voice_muted
  const isServerDeafened = (userId) => !!memberFor(userId)?.voice_deafened

  // Load my blocked/friends lists once so the context menu labels are right.
  useEffect(() => {
    if (!myUid) return
    let cancelled = false

    const loadRelations = async () => {
      try {
        const blocked = await pb.collection('blocked_users').getFullList({
          filter: `blocker="${myUid}"`,
          requestKey: null,
        })
        if (!cancelled) setBlockedUserIds(new Set(blocked.map((b) => b.blocked)))
      } catch (err) {
        console.error('Load blocked users error:', err)
      }

      try {
        const friendsA = await pb.collection('friends').getFullList({
          filter: `user_a="${myUid}"`,
          requestKey: null,
        })
        const friendsB = await pb.collection('friends').getFullList({
          filter: `user_b="${myUid}"`,
          requestKey: null,
        })
        if (!cancelled) {
          setFriendUserIds(new Set([
            ...friendsA.map((f) => f.user_b),
            ...friendsB.map((f) => f.user_a),
          ]))
        }
      } catch (err) {
        console.error('Load friends error:', err)
      }
    }

    loadRelations()
    return () => { cancelled = true }
  }, [myUid])

  // Detach every track this client attached and tear the room down. LiveKit
  // appends audio <audio> elements to document.body itself via track.attach();
  // if we don't remove them, they keep playing (and leak) after leaving.
  const cleanupRoom = async () => {
    const room = roomRef.current
    roomRef.current = null

    if (room) {
      try {
        await room.disconnect()
      } catch (err) {
        console.error('Disconnect room error:', err)
      }
    }

    document.querySelectorAll('[id^="audio-"]').forEach((el) => el.remove())
    if (localVideoRef.current) localVideoRef.current.innerHTML = ''
    if (remoteVideosRef.current) remoteVideosRef.current.innerHTML = ''

    setParticipants([])
    setCameraOn(false)
    deafenedRef.current = false
    setServerMuted(false)
    setServerDeafened(false)
    setConnected(false)
  }

  // If the component unmounts while still connected (e.g. navigating away),
  // make sure the call is actually left rather than left running in the
  // background with a stale microphone.
  useEffect(() => {
    return () => {
      const room = roomRef.current
      roomRef.current = null
      if (room) room.disconnect().catch(() => {})
      document.querySelectorAll('[id^="audio-"]').forEach((el) => el.remove())
    }
  }, [])

  const handleJoin = async () => {
    setError('')
    setConnecting(true)

    try {
      const response = await fetch(`${TOKEN_SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: channel.id,
          token: pb.authStore.token,
        }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || 'Could not get a voice token')
      }

      const data = await response.json()

      const room = new Room()
      roomRef.current = room

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === 'audio') {
          const el = track.attach()
          el.id = `audio-${track.sid}`
          // Tag with the publisher so local mute/deafen can target them.
          el.setAttribute('data-participant', participant?.identity || '')
          document.body.appendChild(el)
          applyAudioFilters()
        }

        if (track.kind === 'video') {
          const el = track.attach()
          el.id = `video-${track.sid}`
          el.style.width = '200px'
          el.style.margin = '5px'
          if (remoteVideosRef.current) {
            remoteVideosRef.current.appendChild(el)
          }
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove())
      })

      room.on(RoomEvent.ParticipantConnected, () => {
        updateParticipants(room)
      })

      room.on(RoomEvent.ParticipantDisconnected, () => {
        updateParticipants(room)
      })

      await room.connect(data.url, data.token)

      const mutedByServer = data.voiceMuted === true
      const deafenedByServer = data.voiceDeafened === true
      setServerMuted(mutedByServer)
      setServerDeafened(deafenedByServer)

      const savedMicId = localStorage.getItem('orbit_mic_id')
      // A server-muted/deafened user is granted canPublish:false, and a
      // self-muted/deafened user doesn't want to publish — join with the mic
      // off in those cases.
      const canPublish = !mutedByServer && !deafenedByServer && !selfMuted && !selfDeafened
      await room.localParticipant.setMicrophoneEnabled(
        canPublish,
        savedMicId ? { deviceId: savedMicId } : undefined
      )

      setConnected(true)
      updateParticipants(room)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not join voice channel. Make sure the token server is running.')
    } finally {
      setConnecting(false)
    }
  }

  const updateParticipants = (room) => {
    const remote = Array.from(room.remoteParticipants.values()).map((p) => ({
      identity: p.identity,
      name: p.name || p.identity,
    }))
    setParticipants(remote)
  }

  // Local (this-viewer-only) mute/deafen of another user. They still hear you.
  const toggleLocalMute = (userId) => {
    const next = new Set(localMutedRef.current)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    localMutedRef.current = next
    setLocalMutedIds(next)
    applyAudioFilters()
  }

  const toggleLocalDeafen = (userId) => {
    const next = new Set(localDeafenedRef.current)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    localDeafenedRef.current = next
    setLocalDeafenedIds(next)
    applyAudioFilters()
  }

  // Moderator server mute/deafen (owner or mute_move_members). Authoritative
  // server-side; the members subscription updates everyone's view.
  const moderateVoiceUser = async (userId, changes) => {
    try {
      const response = await fetch(`${TOKEN_SERVER_URL}/voice/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: pb.authStore.token,
          serverId: channel.server,
          targetUserId: userId,
          ...changes,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not update voice state')

      if (userId === myUid) {
        setServerMuted(data.voice_muted)
        setServerDeafened(data.voice_deafened)
        if ((data.voice_muted || data.voice_deafened) && roomRef.current) {
          await roomRef.current.localParticipant.setMicrophoneEnabled(false)
        }
      }
    } catch (err) {
      console.error('Voice moderation error:', err)
    }
  }

  const handleToggleCamera = async () => {
    if (!roomRef.current) return
    const newCameraOn = !cameraOn

    const savedCameraId = localStorage.getItem('orbit_camera_id')
    await roomRef.current.localParticipant.setCameraEnabled(
      newCameraOn,
      savedCameraId ? { deviceId: savedCameraId } : undefined
    )

    if (newCameraOn) {
      const videoPub = Array.from(roomRef.current.localParticipant.videoTrackPublications.values())[0]
      if (videoPub?.track && localVideoRef.current) {
        localVideoRef.current.innerHTML = ''
        const el = videoPub.track.attach()
        el.style.width = '200px'
        localVideoRef.current.appendChild(el)
      }
    } else if (localVideoRef.current) {
      localVideoRef.current.innerHTML = ''
    }

    setCameraOn(newCameraOn)
  }

  const handleLeave = async () => {
    await cleanupRoom()
  }

  const handleAddFriend = async (targetUserId) => {
    try {
      const existing = await pb.collection('friend_requests').getFullList({
        filter: `(from_user="${myUid}" && to_user="${targetUserId}") || (from_user="${targetUserId}" && to_user="${myUid}")`,
      })
      if (existing.some((r) => r.status === 'pending')) return
      await pb.collection('friend_requests').create({
        from_user: myUid,
        to_user: targetUserId,
        status: 'pending',
        context_server: server?.id || undefined,
      })
    } catch (err) {
      console.error('Add friend error:', err)
    }
  }

  const handleToggleBlock = async (targetUserId) => {
    try {
      if (blockedUserIds.has(targetUserId)) {
        const existing = await pb.collection('blocked_users').getFullList({
          filter: `blocker="${myUid}" && blocked="${targetUserId}"`,
        })
        if (existing[0]) await pb.collection('blocked_users').delete(existing[0].id)
        setBlockedUserIds((prev) => {
          const next = new Set(prev)
          next.delete(targetUserId)
          return next
        })
      } else {
        await pb.collection('blocked_users').create({ blocker: myUid, blocked: targetUserId })
        setBlockedUserIds((prev) => new Set(prev).add(targetUserId))
      }
    } catch (err) {
      console.error('Toggle block error:', err)
    }
  }

  const handleReportUserProfile = async (targetUserId) => {
    try {
      await pb.collection('reports').create({
        reported_by: myUid,
        target_type: 'user_profile',
        target_id: targetUserId,
        reason: 'Reported from profile',
        status: 'pending',
      })
    } catch (err) {
      console.error('Report user profile error:', err)
    }
  }

  const participantRowProps = (userId) => ({
    style: { cursor: 'pointer' },
    onClick: (e) => {
      if (!userId) return
      setServerPopup({ x: e.clientX, y: e.clientY, userId })
    },
    onContextMenu: (e) => {
      if (!userId) return
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, userId, isSelf: userId === myUid })
    },
  })

  return (
    <div className="channel-view-shell">
      <div className="channel-main">
        <div className="channel-topbar">
          {onBack && (
            <button className="channel-back-btn" onClick={onBack} title="Back">←</button>
          )}
          <span className="channel-topbar-icon">🔊</span>
          <h2>{channel.name}</h2>
        </div>

        <div style={{ padding: '24px' }}>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

          {!connected && (
            <button className="btn-primary" onClick={handleJoin} disabled={connecting}>
              {connecting ? 'Joining...' : 'Join Voice'}
            </button>
          )}

          {connected && (
            <div>
              <p style={{ color: 'var(--teal)' }}>You're connected.</p>
              {serverMuted && (
                <p style={{ color: 'var(--warning)' }}>
                  You've been server-muted by a moderator. You can still hear others, but you can't speak until you're unmuted.
                </p>
              )}
              {serverDeafened && (
                <p style={{ color: 'var(--warning)' }}>
                  You've been server-deafened by a moderator. You can't hear or speak in this server's voice channels until you're undeafened.
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                <button onClick={toggleMute} disabled={serverMuted || serverDeafened}>
                  {serverMuted || serverDeafened ? 'Muted by moderator' : muted ? 'Unmute' : 'Mute'}
                </button>
                <button onClick={toggleDeafen} disabled={serverDeafened}>
                  {serverDeafened ? 'Deafened by moderator' : deafened ? 'Undeafen' : 'Deafen'}
                </button>
                <button onClick={handleToggleCamera}>
                  {cameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
                </button>
                <button className="btn-danger" onClick={handleLeave}>
                  Leave
                </button>
              </div>

              <h3>In this channel</h3>
              <ul className="list-reset">
                <li
                  className="list-row"
                  style={{ justifyContent: 'flex-start', gap: '8px', cursor: 'pointer' }}
                  {...participantRowProps(myUid)}
                >
                  {pb.authStore.model.name} (you)
                  {muted && <span style={{ color: 'var(--text)', fontSize: '0.8em' }}> · mic off</span>}
                  {deafened && <span style={{ color: 'var(--text)', fontSize: '0.8em' }}> · deafened</span>}
                  {serverMuted && <span style={{ color: 'var(--warning)', fontSize: '0.8em' }}> · server muted</span>}
                  {serverDeafened && <span style={{ color: 'var(--warning)', fontSize: '0.8em' }}> · server deafened</span>}
                </li>
                {participants.map((p) => (
                  <li
                    key={p.identity}
                    className="list-row"
                    style={{ justifyContent: 'flex-start', gap: '8px' }}
                    {...participantRowProps(p.identity)}
                  >
                    {p.name}
                    {localMutedIds.has(p.identity) && <span style={{ color: 'var(--text)', fontSize: '0.8em' }}> · muted for you</span>}
                    {localDeafenedIds.has(p.identity) && <span style={{ color: 'var(--text)', fontSize: '0.8em' }}> · deafened for you</span>}
                    {isServerMuted(p.identity) && <span style={{ color: 'var(--warning)', fontSize: '0.8em' }}> · server muted</span>}
                    {isServerDeafened(p.identity) && <span style={{ color: 'var(--warning)', fontSize: '0.8em' }}> · server deafened</span>}
                  </li>
                ))}
              </ul>

              <h3>Video</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <div ref={localVideoRef}></div>
                <div ref={remoteVideosRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {members && (
        <MembersSidebar
          members={members}
          ownerName={ownerName}
          ownerStatus={ownerStatus}
          ownerAvatarUrl={ownerAvatarUrl}
          ownerLastSeen={ownerLastSeen}
          serverId={channel.server}
          ownerId={ownerId}
          showOfflineMembers={showOfflineMembers}
          onStartCall={onStartCallWithUser}
          onMessage={onMessageUser}
        />
      )}

      {contextMenu && (
        <UserContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetUser={{ id: contextMenu.userId }}
          isSelf={contextMenu.isSelf}
          isFriend={friendUserIds.has(contextMenu.userId)}
          isBlocked={blockedUserIds.has(contextMenu.userId)}
          onClose={() => setContextMenu(null)}
          onProfile={() => setFullProfileUserId(contextMenu.userId)}
          onStartCall={() => onStartCallWithUser?.(contextMenu.userId)}
          onInviteToServer={() => { setInviteTargetUserId(contextMenu.userId); setContextMenu(null) }}
          onAddFriend={() => handleAddFriend(contextMenu.userId)}
          onBlock={() => handleToggleBlock(contextMenu.userId)}
          isLocallyMuted={localMutedIds.has(contextMenu.userId)}
          onToggleLocalMute={() => toggleLocalMute(contextMenu.userId)}
          isLocallyDeafened={localDeafenedIds.has(contextMenu.userId)}
          onToggleLocalDeafen={() => toggleLocalDeafen(contextMenu.userId)}
          canModerateVoice={!!canMuteMembers && !contextMenu.isSelf && contextMenu.userId !== server?.owner}
          isServerMuted={isServerMuted(contextMenu.userId)}
          onToggleServerMute={() => moderateVoiceUser(contextMenu.userId, { muted: !isServerMuted(contextMenu.userId) })}
          isServerDeafened={isServerDeafened(contextMenu.userId)}
          onToggleServerDeafen={() => moderateVoiceUser(contextMenu.userId, { deafened: !isServerDeafened(contextMenu.userId) })}
        />
      )}

      {serverPopup && (
        <ServerProfilePopup
          x={serverPopup.x}
          y={serverPopup.y}
          targetUserId={serverPopup.userId}
          serverId={channel.server}
          onClose={() => setServerPopup(null)}
          onMessage={() => { onMessageUser?.(serverPopup.userId); setServerPopup(null) }}
          onViewFullProfile={() => { setFullProfileUserId(serverPopup.userId); setServerPopup(null) }}
        />
      )}

      {fullProfileUserId && (
        <FullProfileModal
          targetUserId={fullProfileUserId}
          serverId={channel.server}
          isBlocked={blockedUserIds.has(fullProfileUserId)}
          onClose={() => setFullProfileUserId(null)}
          onViewPerServerProfile={() => {
            const userId = fullProfileUserId
            setFullProfileUserId(null)
            setServerPopup({ x: window.innerWidth / 2 - 140, y: 100, userId })
          }}
          onInviteToServer={() => { setInviteTargetUserId(fullProfileUserId); setFullProfileUserId(null) }}
          onBlock={() => handleToggleBlock(fullProfileUserId)}
          onReport={() => handleReportUserProfile(fullProfileUserId)}
          onMessage={() => { onMessageUser?.(fullProfileUserId); setFullProfileUserId(null) }}
        />
      )}

      {inviteTargetUserId && (
        <InviteToServerModal
          serverId={channel.server}
          targetUserId={inviteTargetUserId}
          onClose={() => setInviteTargetUserId(null)}
        />
      )}
    </div>
  )
}

export default VoiceChannel
