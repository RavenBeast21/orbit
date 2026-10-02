// CreateServer.jsx
import { useState } from 'react'
import pb from '../pocketbase'
import TagPicker from './TagPicker'
import { sanitizeTags } from '../serverTags'

function CreateServer({ onCreated, joinServerId, setJoinServerId, onJoinServer, joinLoading, joinError }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('friends')
  const [discoveryVisible, setDiscoveryVisible] = useState(false)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Gaming')
  const [tags, setTags] = useState([])
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
        tags: type === 'community' && discoveryVisible ? sanitizeTags(tags) : [],
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
    <div className="panel" style={{ maxWidth: '480px' }}>
      <h1>Add a Server</h1>
      <p style={{ color: 'var(--text)' }}>Your server is where you and your friends hang out. Make yours and start talking.</p>
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label>Server Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label>Server Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="friends">Friends (Invite Only)</option>
            <option value="community">Community</option>
            <option value="business">Business (Invite Only)</option>
          </select>
        </div>

        {type === 'community' && (
          <div className="form-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={discoveryVisible}
                onChange={(e) => setDiscoveryVisible(e.target.checked)}
              />
              Show this server on the discovery page
            </label>

            {discoveryVisible && (
              <>
                <div className="form-field">
                  <label>Description</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What's this server about?"
                  />
                </div>

                <div className="form-field">
                  <label>Category</label>
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

                <div className="form-field form-field--tags">
                  <TagPicker value={tags} onChange={setTags} idPrefix="create-server-tags" />
                </div>
              </>
            )}
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Creating...' : 'Create Server'}
        </button>
      </form>

      {onJoinServer && (
        <>
          <hr />
          <h2>Already have an invite?</h2>
          <form onSubmit={onJoinServer} className="inline-form">
            <input
              type="text"
              placeholder="Paste invite code"
              value={joinServerId}
              onChange={(e) => setJoinServerId(e.target.value)}
            />
            <button type="submit" disabled={joinLoading}>
              {joinLoading ? 'Joining...' : 'Join a Server'}
            </button>
          </form>
          {joinError && <p style={{ color: 'var(--danger)' }}>{joinError}</p>}
        </>
      )}
    </div>
  )
}

export default CreateServer