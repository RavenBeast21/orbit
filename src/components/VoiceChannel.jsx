import { useState, useRef } from 'react'
import { Room, RoomEvent } from 'livekit-client'
import pb from '../pocketbase'

function VoiceChannel({ channel, onBack }) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [participants, setParticipants] = useState([])
  const [error, setError] = useState('')

  const roomRef = useRef(null)

  const handleJoin = async () => {
    setError('')
    setConnecting(true)

    try {
      const response = await fetch('http://localhost:3001/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: channel.id,
          identity: pb.authStore.model.id,
          name: pb.authStore.model.name,
        }),
      })

      const data = await response.json()

      const room = new Room()
      roomRef.current = room

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'audio') {
          const el = track.attach()
          el.id = `audio-${track.sid}`
          document.body.appendChild(el)
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
      await room.localParticipant.setMicrophoneEnabled(true)

      setConnected(true)
      updateParticipants(room)
    } catch (err) {
      console.error(err)
      setError('Could not join voice channel. Make sure the token server is running.')
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

  const handleLeave = async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect()
      roomRef.current = null
    }
    setConnected(false)
    setParticipants([])
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
        </div>
      )}
    </div>
  )
}

export default VoiceChannel