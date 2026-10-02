import { useState, useEffect, useRef } from 'react'
import { Room, RoomEvent } from 'livekit-client'
import pb from '../pocketbase'
import { TOKEN_SERVER_URL } from '../config'
import { useVoiceState, getVoiceState, toggleMute, toggleDeafen } from '../voiceState'

// A call tied to a single DM thread. Handles the full lifecycle:
//   ringing (caller waiting / callee being asked) -> active (connected) -> ended
//
// Props:
//   dmThreadId  - the dm_threads record id, doubles as the LiveKit room name
//   otherUser   - the other participant's user record (for name/avatar display)
//   isInitiator - true if THIS session should create the ringing call record
//                 (i.e. this is the "Start a Call" flow, not joining one
//                 already in progress)
//   onClose     - called once the call is fully over and the UI should
//                 return to the normal DM view
function DMCall({ dmThreadId, otherUser, isInitiator, onClose }) {
  const [call, setCall] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Self mute/deafen are shared with the always-visible user panel.
  const { muted, deafened } = useVoiceState()
  const [cameraOn, setCameraOn] = useState(false)
  const [connected, setConnected] = useState(false)
  const [participants, setParticipants] = useState([])

  const roomRef = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideosRef = useRef(null)
  const uid = pb.authStore.model.id

  // --- Load/create the dm_calls record, and keep it live via subscription ---
  useEffect(() => {
    let cancelled = false
    let unsub

    const init = async () => {
      try {
        const existing = await pb.collection('dm_calls').getFullList({
          filter: `dm_thread="${dmThreadId}" && (status="ringing" || status="active")`,
          requestKey: null,
        })

        if (existing.length > 0) {
          if (!cancelled) setCall(existing[0])
        } else if (isInitiator) {
          const created = await pb.collection('dm_calls').create({
            dm_thread: dmThreadId,
            caller: uid,
            status: 'ringing',
            kind: 'voice',
          })
          if (!cancelled) setCall(created)
        } else {
          // No active/ringing call and we're not starting one — nothing to show.
          if (!cancelled) onClose()
          return
        }
      } catch (err) {
        console.error('DM call init error:', err)
        if (!cancelled) setError('Something went wrong starting the call')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()

    pb.collection('dm_calls').subscribe('*', (e) => {
      if (e.record.dm_thread !== dmThreadId) return
      if (e.action === 'update' || e.action === 'create') {
        setCall(e.record)
      }
    }).then((fn) => { unsub = fn })

    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [dmThreadId])

  // --- Join LiveKit once the call becomes active (for both caller and callee) ---
  useEffect(() => {
    if (call?.status === 'active' && !connected && !roomRef.current) {
      joinRoom()
    }
    if (call?.status === 'declined' || call?.status === 'ended' || call?.status === 'missed') {
      cleanupRoom()
      const timer = setTimeout(() => onClose(), 1500)
      return () => clearTimeout(timer)
    }
  }, [call?.status])

  useEffect(() => {
    return () => { cleanupRoom() }
  }, [])

  const cleanupRoom = () => {
    if (roomRef.current) {
      roomRef.current.disconnect()
      roomRef.current = null
    }
  }

  const updateParticipants = (room) => {
    const remote = Array.from(room.remoteParticipants.values()).map((p) => p.name || p.identity)
    setParticipants(remote)
  }

  const joinRoom = async () => {
    setError('')
    try {
      const response = await fetch(`${TOKEN_SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: dmThreadId,
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

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'audio') {
          const el = track.attach()
          el.id = `audio-${track.sid}`
          el.muted = getVoiceState().deafened
          document.body.appendChild(el)
        }
        if (track.kind === 'video') {
          const el = track.attach()
          el.id = `video-${track.sid}`
          el.style.width = '200px'
          el.style.margin = '5px'
          if (remoteVideosRef.current) remoteVideosRef.current.appendChild(el)
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove())
      })

      room.on(RoomEvent.ParticipantConnected, () => updateParticipants(room))
      room.on(RoomEvent.ParticipantDisconnected, () => updateParticipants(room))

      await room.connect(data.url, data.token)

      const savedMicId = localStorage.getItem('orbit_mic_id')
      await room.localParticipant.setMicrophoneEnabled(
        !muted,
        savedMicId ? { deviceId: savedMicId } : undefined
      )

      setConnected(true)
      updateParticipants(room)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not join the call. Make sure the token server is running.')
    }
  }

  // Apply shared mute/deafen to the active call.
  useEffect(() => {
    const room = roomRef.current
    if (!room || !connected) return
    room.localParticipant.setMicrophoneEnabled(!muted).catch(() => {})
  }, [muted, connected])

  useEffect(() => {
    document.querySelectorAll('[id^="audio-"]').forEach((el) => { el.muted = deafened })
  }, [deafened])

  const handleAccept = async () => {
    try {
      await pb.collection('dm_calls').update(call.id, { status: 'active' })
    } catch (err) {
      console.error('Accept call error:', err)
    }
  }

  // Caller cancelling before anyone answers is a MISSED call for the callee;
  // the callee rejecting is a DECLINED call. Both close the log entry with an
  // end time (report §4.42).
  const handleDecline = async () => {
    try {
      const isCaller = call.caller === uid
      await pb.collection('dm_calls').update(call.id, {
        status: isCaller ? 'missed' : 'declined',
        ended_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('Decline call error:', err)
      onClose()
    }
  }

  const handleLeave = async () => {
    try {
      await pb.collection('dm_calls').update(call.id, {
        status: 'ended',
        ended_at: new Date().toISOString(),
        kind: cameraOn ? 'video' : (call.kind || 'voice'),
      })
    } catch (err) {
      console.error('End call error:', err)
    }
    cleanupRoom()
    setConnected(false)
    onClose()
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

    // Once video is used, the log entry is a video call (report §4.42).
    if (newCameraOn && call?.id) {
      pb.collection('dm_calls').update(call.id, { kind: 'video' }, { requestKey: null })
        .catch((err) => console.error('Update call kind error:', err))
    }
  }

  if (loading || !call) {
    return (
      <div className="dm-call-overlay">
        <p style={{ color: 'var(--text)' }}>Connecting...</p>
      </div>
    )
  }

  const isCaller = call.caller === uid
  const otherName = otherUser?.name || 'Unknown'
  const otherAvatarUrl = otherUser?.avatar ? pb.files.getURL(otherUser, otherUser.avatar, { thumb: '80x80' }) : null

  return (
    <div className="dm-call-overlay">
      {otherAvatarUrl ? (
        <img src={otherAvatarUrl} alt="" className="dm-call-avatar" />
      ) : (
        <div className="dm-call-avatar dm-call-avatar-fallback" />
      )}
      <h2>{otherName}</h2>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {call.status === 'ringing' && isCaller && (
        <>
          <p style={{ color: 'var(--text)' }}>Calling...</p>
          <button className="btn-danger" onClick={handleDecline}>Cancel</button>
        </>
      )}

      {call.status === 'ringing' && !isCaller && (
        <>
          <p style={{ color: 'var(--text)' }}>Incoming call...</p>
          <div className="dm-call-actions">
            <button className="btn-primary" onClick={handleAccept}>Accept</button>
            <button className="btn-danger" onClick={handleDecline}>Reject</button>
          </div>
        </>
      )}

      {call.status === 'active' && (
        <>
          <p style={{ color: 'var(--teal)' }}>{connected ? "You're connected." : 'Joining...'}</p>

          {connected && (
            <>
              <div className="dm-call-actions">
                <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
                <button onClick={toggleDeafen}>{deafened ? 'Undeafen' : 'Deafen'}</button>
                <button onClick={handleToggleCamera}>{cameraOn ? 'Turn Camera Off' : 'Turn Camera On'}</button>
                <button className="btn-danger" onClick={handleLeave}>Leave</button>
              </div>

              {participants.length > 0 && (
                <p style={{ color: 'var(--text)' }}>{participants.length} other participant(s) connected</p>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
                <div ref={localVideoRef}></div>
                <div ref={remoteVideosRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}></div>
              </div>
            </>
          )}
        </>
      )}

      {(call.status === 'declined' || call.status === 'ended' || call.status === 'missed') && (
        <p style={{ color: 'var(--text)' }}>
          {call.status === 'declined' ? 'Call declined.' : call.status === 'missed' ? 'Call cancelled.' : 'Call ended.'}
        </p>
      )}
    </div>
  )
}

export default DMCall