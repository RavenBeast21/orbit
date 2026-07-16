// ServerView.jsx (new file)
function ServerView({ server }) {
  const [channels, setChannels] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [channelName, setChannelName] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const isOwner = server.owner === pb.authStore.model.id

  const loadChannels = async () => {
    try {
      const records = await pb.collection('channels').getFullList({
        filter: `server="${server.id}"`,
      })
      setChannels(records)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadChannels()
  }, [])

  const handleCreateChannel = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')

    if (!channelName.trim()) {
      setError('Channel name is required')
      return
    }

    setLoading(true)

    try {
      await pb.collection('channels').create({
        name: channelName,
        server: server.id,
      })

      setSuccessMessage('Channel successfully created')
      setChannelName('')
      setShowCreateForm(false)
      loadChannels()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong creating the channel')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p style={{ color: 'lightgreen' }}>Server successfully created</p>
      <h1>{server.name}</h1>
      <p>Type: {server.type}</p>

      <hr />

      <h2>Channels</h2>
      {successMessage && <p style={{ color: 'lightgreen' }}>{successMessage}</p>}

      <ul>
        {channels.map((channel) => (
          <li key={channel.id}>{channel.name}</li>
        ))}
      </ul>

      {channels.length === 0 && <p>No channels yet.</p>}

      {isOwner && (
        <>
          {!showCreateForm && (
            <button onClick={() => setShowCreateForm(true)}>Create Channel</button>
          )}

          {showCreateForm && (
            <form onSubmit={handleCreateChannel}>
              <input
                type="text"
                placeholder="Channel name"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
              />
              <button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowCreateForm(false)}>
                Cancel
              </button>
              {error && <p style={{ color: 'red' }}>{error}</p>}
            </form>
          )}
        </>
      )}
    </div>
  )
}

export default ServerView