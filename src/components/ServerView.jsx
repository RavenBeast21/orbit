import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import ChannelView from './ChannelView'
import VoiceChannel from './VoiceChannel'

function ServerView({ server, onBack }) {
  const [channels, setChannels] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [channelName, setChannelName] = useState('')
  const [channelType, setChannelType] = useState('text')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeChannel, setActiveChannel] = useState(null)
  const [members, setMembers] = useState([])
  const [myMembership, setMyMembership] = useState(null)
  const [reportingId, setReportingId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportStatus, setReportStatus] = useState('')

  const uid = pb.authStore.model.id
  const isOwner = server.owner === uid

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

  const loadMembers = async () => {
    try {
      const records = await pb.collection('members').getFullList({
        filter: `server="${server.id}"`,
        expand: 'user',
      })
      setMembers(records)

      const mine = records.find((m) => m.user === uid)
      setMyMembership(mine || null)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadChannels()
    loadMembers()

    pb.collection('members').subscribe('*', (e) => {
      if (e.record.server !== server.id) return
      loadMembers()
    })

    return () => {
      pb.collection('members').unsubscribe('*')
    }
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
        type: channelType,
      })

      setSuccessMessage('Channel successfully created')
      setChannelName('')
      setChannelType('text')
      setShowCreateForm(false)
      loadChannels()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong creating the channel')
    } finally {
      setLoading(false)
    }
  }

  const handleChangeRole = async (memberId, newRole) => {
    try {
      await pb.collection('members').update(memberId, { role: newRole })
      loadMembers()
    } catch (err) {
      console.error(err)
    }
  }

  const handleLeaveServer = async () => {
    if (!myMembership) return

    try {
      await pb.collection('members').delete(myMembership.id)
      onBack()
    } catch (err) {
      console.error(err)
    }
  }

  const handleSubmitReport = async (targetType, targetId) => {
    if (!reportReason.trim()) {
      setReportStatus('Please enter a reason')
      return
    }

    try {
      await pb.collection('reports').create({
        reported_by: uid,
        target_type: targetType,
        target_id: targetId,
        reason: reportReason,
        status: 'pending',
      })
      setReportStatus('Report submitted')
      setReportReason('')
      setTimeout(() => {
        setReportingId(null)
        setReportStatus('')
      }, 1500)
    } catch (err) {
      console.error(err)
      setReportStatus('Something went wrong submitting the report')
    }
  }

  if (activeChannel && activeChannel.type === 'voice') {
    return <VoiceChannel channel={activeChannel} onBack={() => setActiveChannel(null)} />
  }

  if (activeChannel) {
    return <ChannelView channel={activeChannel} onBack={() => setActiveChannel(null)} />
  }

  return (
    <div>
      <button onClick={onBack}>← Back to your servers</button>
      <h1>{server.name}</h1>
      <p>Type: {server.type}</p>

      {!isOwner && myMembership && (
        <button onClick={handleLeaveServer} style={{ color: 'red' }}>
          Leave Server
        </button>
      )}

      {' '}
      <button onClick={() => setReportingId(reportingId === 'server' ? null : 'server')}>
        Report Server
      </button>

      {reportingId === 'server' && (
        <div>
          <input
            type="text"
            placeholder="Reason for report"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
          />
          <button onClick={() => handleSubmitReport('server', server.id)}>Submit Report</button>
          {reportStatus && <p>{reportStatus}</p>}
        </div>
      )}

      <hr />

      <h2>Channels</h2>
      {successMessage && <p style={{ color: 'lightgreen' }}>{successMessage}</p>}

      <ul>
        {channels.map((channel) => (
          <li key={channel.id}>
            <button onClick={() => setActiveChannel(channel)}>
              {channel.type === 'voice' ? '🔊' : '#'} {channel.name}
            </button>
          </li>
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
              <select value={channelType} onChange={(e) => setChannelType(e.target.value)}>
                <option value="text">Text</option>
                <option value="voice">Voice</option>
              </select>
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

      <hr />

      <h2>Members</h2>
      <ul>
        <li>
          <strong>{pb.authStore.model.name}</strong> (Owner) — this is the owner if you're viewing your own server
        </li>
        {members.map((member) => (
          <li key={member.id}>
            {member.expand?.user?.name || 'Unknown'} — {member.role}
            {isOwner && (
              <>
                {' '}
                {member.role === 'member' ? (
                  <button onClick={() => handleChangeRole(member.id, 'mod')}>
                    Promote to Mod
                  </button>
                ) : (
                  <button onClick={() => handleChangeRole(member.id, 'member')}>
                    Demote to Member
                  </button>
                )}
              </>
            )}
            {' '}
            <button
              onClick={() =>
                setReportingId(reportingId === member.id ? null : member.id)
              }
            >
              Report
            </button>

            {reportingId === member.id && (
              <div>
                <input
                  type="text"
                  placeholder="Reason for report"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                />
                <button onClick={() => handleSubmitReport('user', member.user)}>
                  Submit Report
                </button>
                {reportStatus && <p>{reportStatus}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ServerView