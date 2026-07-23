import { useState, useRef } from 'react'
import { Room, RoomEvent } from 'livekit-client'
import pb from '../pocketbase'

function VoiceChannel({ channel, onBack }) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [participants, setParticipants] = useState([])
  const [error, setError] = useState('')

  const roomRef = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideosRef = useRef(null)

  const handleJoin = async () => {
    setError('')
    setConnecting(true)

    try {
      const response = await fetch('http://localhost:3001/token', {
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

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'audio') {
          const el = track.attach()
          el.id = `audio-${track.sid}`
          document.body.appendChild(el)
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

      const savedMicId = localStorage.getItem('orbit_mic_id')
      await room.localParticipant.setMicrophoneEnabled(
        true,
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
    const remote = Array.from(room.remoteParticipants.values()).map((p) => p.name || p.identity)
    setParticipants(remote)
  }

  const handleToggleMute = async () => {
    if (!roomRef.current) return
    const newMuted = !muted
    await roomRef.current.localParticipant.setMicrophoneEnabled(!newMuted)
    setMuted(newMuted)
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
    if (roomRef.current) {
      await roomRef.current.disconnect()
      roomRef.current = null
    }
    setConnected(false)
    setParticipants([])
    setCameraOn(false)
    if (localVideoRef.current) localVideoRef.current.innerHTML = ''
    if (remoteVideosRef.current) remoteVideosRef.current.innerHTML = ''
  }

  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h1>🔊 {channel.name}</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!connected && (
        <button onClick={handleJoin} disabled={connecting}>
          {connecting ? 'Joining...' : 'Join Voice'}
        </button>
      )}

      {connected && (
        <div>
          <p>You're connected.</p>
          <button onClick={handleToggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
          {' '}
          <button onClick={handleToggleCamera}>
            {cameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
          </button>
          {' '}
          <button onClick={handleLeave} style={{ color: 'red' }}>
            Leave
          </button>

          <h3>In this channel:</h3>
          <p>{pb.authStore.model.name} (you)</p>
          <ul>
            {participants.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>

          <h3>Video</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <div ref={localVideoRef}></div>
            <div ref={remoteVideosRef} style={{ display: 'flex', flexWrap: 'wrap' }}></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VoiceChannel