import { useState, useEffect } from 'react'
import pb from '../pocketbase'

const CATEGORIES = ['All', 'Gaming', 'Music', 'Education', 'Technology', 'Art & Design', 'Community', 'Other']

function Discovery({ onBack, onJoined }) {
  const [servers, setServers] = useState([])
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [joiningId, setJoiningId] = useState(null)

  const uid = pb.authStore.model.id

  const loadServers = async () => {
    setLoading(true)
    setError('')
    try {
      const records = await pb.collection('servers').getFullList({
        filter: `type="community" && discovery_visible=true`,
      })
      setServers(records)
    } catch (err) {
      console.error('Load discovery servers error:', err)
      setError('Failed to load servers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadServers()
  }, [])

  const handleJoin = async (server) => {
    setError('')
    setJoiningId(server.id)

    try {
      if (server.owner === uid) {
        if (onJoined) onJoined(server)
        return
      }

      const existingBans = await pb.collection('bans').getFullList({
        filter: `user="${uid}" && server="${server.id}"`,
      })
      if (existingBans.length > 0) {
        setError(`You're banned from ${server.name}`)
        return
      }

      const existingMembership = await pb.collection('members').getFullList({
        filter: `user="${uid}" && server="${server.id}"`,
      })
      if (existingMembership.length > 0) {
        if (onJoined) onJoined(server)
        return
      }

      await pb.collection('members').create({
        user: uid,
        server: server.id,
      })

      if (onJoined) onJoined(server)
    } catch (err) {
      console.error('Join error:', err)
      setError(err.message || 'Something went wrong joining this server')
    } finally {
      setJoiningId(null)
    }
  }

  const filteredServers = category === 'All' ? servers : servers.filter((s) => s.category === category)

  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h1>Discover Servers</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            style={{
              backgroundColor: category === c ? '#333' : 'transparent',
              border: '1px solid #333',
              borderRadius: '4px',
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {loading && <p>Loading servers...</p>}

      {!loading && filteredServers.length === 0 && <p>No servers found in this category.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredServers.map((server) => (
          <div key={server.id} style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            {server.icon ? (
              <img
                src={pb.files.getURL(server, server.icon, { thumb: '48x48' })}
                alt=""
                style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#333', flexShrink: 0 }} />
            )}

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong>{server.name}</strong>
                <span style={{ fontSize: '0.8em', color: 'gray' }}>{server.category}</span>
              </div>
              {server.description && (
                <p style={{ color: 'lightgray', margin: '4px 0' }}>{server.description}</p>
              )}
            </div>

            <button onClick={() => handleJoin(server)} disabled={joiningId === server.id}>
              {joiningId === server.id ? 'Joining...' : 'Join'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Discovery