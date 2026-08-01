// CreateServer.jsx
import { useState } from 'react'
import pb from '../pocketbase'

function CreateServer({ onCreated }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('friends')
  const [discoveryVisible, setDiscoveryVisible] = useState(false)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Gaming')
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
        description: type === 'community' ? description : '',
        category: type === 'community' ? category : '',
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

            {discoveryVisible && (
              <>
                <div>
                  <label>Description</label>
                  <br />
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What's this server about?"
                  />
                </div>

                <div>
                  <label>Category</label>
                  <br />
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="Gaming">Gaming</option>
                    <option value="Music">Music</option>
                    <option value="Education">Education</option>
                    <option value="Technology">Technology</option>
                    <option value="Art & Design">Art & Design</option>
                    <option value="Community">Community</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </>
            )}
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