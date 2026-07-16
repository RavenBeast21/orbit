// CreateServer.jsx
import { useState } from 'react'
import pb from '../pocketbase'

function CreateServer({ onCreated }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('friends')
  const [discoveryVisible, setDiscoveryVisible] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Server name is required')
      return
    }

    setLoading(true)

    try {
      const record = await pb.collection('servers').create({
        name,
        type,
        discovery_visible: type === 'community' ? discoveryVisible : false,
        owner: pb.authStore.model.id,
      })

      onCreated(record)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong creating the server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1>Create a Server</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Server Name</label>
          <br />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label>Server Type</label>
          <br />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="friends">Friends (Invite Only)</option>
            <option value="community">Community</option>
            <option value="business">Business (Invite Only)</option>
          </select>
        </div>

        {type === 'community' && (
          <div>
            <label>
              <input
                type="checkbox"
                checked={discoveryVisible}
                onChange={(e) => setDiscoveryVisible(e.target.checked)}
              />
              Show this server on the discovery page
            </label>
          </div>
        )}

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Server'}
        </button>
      </form>
    </div>
  )
}

export default CreateServer