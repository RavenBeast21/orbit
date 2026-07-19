import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import ChannelView from './ChannelView'
import VoiceChannel from './VoiceChannel'

function ServerView({ server, onBack, setActiveConversation }) {
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

  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState(null)

  const [ownerName, setOwnerName] = useState('')
  const [ownerStatus, setOwnerStatus] = useState('online')

  const [notificationSetting, setNotificationSetting] = useState('all')

  const uid = pb.authStore.model.id
  const isOwner = server.owner === uid

  const [invites, setInvites] = useState([])
  const [showCreateInvite, setShowCreateInvite] = useState(false)
  const [inviteMaxUses, setInviteMaxUses] = useState('')
  const [inviteExpiry, setInviteExpiry] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteCreating, setInviteCreating] = useState(false)

  const loadInvites = async () => {
    if (!isOwner) return
    try {
      const records = await pb.collection('invites').getFullList({
        filter: `server="${server.id}"`,
        sort: '-created',
      })
      setInvites(records)
    } catch (err) {
      console.error('Load invites error:', err)
    }
  }

  const handleCreateInvite = async () => {
    setInviteError('')
    setInviteCreating(true)
    try {
      const data = {
        server: server.id,
        created_by: uid,
        uses: 0,
      }
      if (inviteMaxUses.trim()) data.max_uses = Number(inviteMaxUses)
      if (inviteExpiry) data.expires_at = new Date(inviteExpiry).toISOString()

      await pb.collection('invites').create(data)
      setInviteMaxUses('')
      setInviteExpiry('')
      setShowCreateInvite(false)
      loadInvites()
    } catch (err) {
      console.error('Create invite error:', err)
      setInviteError(err.message || 'Something went wrong creating the invite')
    } finally {
      setInviteCreating(false)
    }
  }

  const handleRevokeInvite = async (inviteId) => {
    try {
      await pb.collection('invites').delete(inviteId)
      loadInvites()
    } catch (err) {
      console.error('Revoke invite error:', err)
    }
  }

  const handleChangeNotificationSetting = async (newSetting) => {
    if (!myMembership) return
    setNotificationSetting(newSetting)
    try {
      await pb.collection('members').update(myMembership.id, { notification_setting: newSetting })
    } catch (err) {
      console.error('Notification setting error:', err)
    }
  }

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
      if (mine) {
        setNotificationSetting(mine.notification_setting || 'all')
      }
    } catch (err) {
      console.error(err)
    }
  }

  const loadOwnerName = async () => {
    try {
      const ownerRecord = await pb.collection('users').getOne(server.owner)
      setOwnerName(ownerRecord.name)
      setOwnerStatus(ownerRecord.status === 'invisible' ? 'offline' : (ownerRecord.status || 'online'))
      setOwnerAvatarUrl(ownerRecord.avatar ? pb.files.getURL(ownerRecord, ownerRecord.avatar, { thumb: '32x32' }) : null)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadChannels()
    loadMembers()
    loadOwnerName()

    let unsubMembers
    let unsubUsers

    pb.collection('members').subscribe('*', (e) => {
      if (e.record.server !== server.id) return
      loadMembers()
    }).then((fn) => {
      unsubMembers = fn
    })

    pb.collection('users').subscribe('*', (e) => {
      if (e.action !== 'update') return

      if (e.record.id === server.owner) {
        setOwnerStatus(e.record.status === 'invisible' ? 'offline' : (e.record.status || 'online'))
      }

      setMembers((prev) =>
        prev.map((m) =>
          m.user === e.record.id
            ? { ...m, expand: { ...m.expand, user: { ...m.expand?.user, status: e.record.status } } }
            : m
        )
      )
    }).then((fn) => {
      unsubUsers = fn
    })

    return () => {
      if (unsubMembers) unsubMembers()
      if (unsubUsers) unsubUsers()
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
    return <ChannelView channel={activeChannel} onBack={() => setActiveChannel(null)} setActiveConversation={setActiveConversation} />
  }

  return (
    <div>
      <button onClick={onBack}>← Back to your servers</button>
      <h1>{server.name}</h1>
      <p>Type: {server.type}</p>

      {!isOwner && myMembership && (
        <div>
          <label>Notification Settings for this server: </label>
          <select
            value={notificationSetting}
            onChange={(e) => handleChangeNotificationSetting(e.target.value)}
          >
            <option value="all">All Messages</option>
            <option value="nothing">Nothing</option>
          </select>
        </div>
      )}
      {isOwner && (
        <p style={{ color: 'gray' }}>
          Per-server notification settings for owners aren't supported yet — this needs a schema change since owners don't have a membership record.
        </p>
      )}

      {isOwner && (
        <div>
          <hr />
          <h2>Invites</h2>

          {!showCreateInvite && (
            <button onClick={() => setShowCreateInvite(true)}>Create Invite</button>
          )}

          {showCreateInvite && (
            <div>
              <div>
                <label>Max uses (leave empty for unlimited)</label>
                <br />
                <input
                  type="number"
                  value={inviteMaxUses}
                  onChange={(e) => setInviteMaxUses(e.target.value)}
                />
              </div>
              <div>
                <label>Expires at (leave empty for never)</label>
                <br />
                <input
                  type="datetime-local"
                  value={inviteExpiry}
                  onChange={(e) => setInviteExpiry(e.target.value)}
                />
              </div>
              <button onClick={handleCreateInvite} disabled={inviteCreating}>
                {inviteCreating ? 'Creating...' : 'Generate Invite'}
              </button>
              <button onClick={() => setShowCreateInvite(false)}>Cancel</button>
              {inviteError && <p style={{ color: 'red' }}>{inviteError}</p>}
            </div>
          )}

          <ul>
            {invites.length === 0 && <p>No active invites.</p>}
            {invites.map((invite) => (
              <li key={invite.id}>
                <strong>{invite.code}</strong>
                {' '}— uses: {invite.uses}{invite.max_users ? `/${invite.max_users}` : ' (unlimited)'}
                {invite.expires_at && `, expires ${new Date(invite.expires_at).toLocaleString()}`}
                {' '}
                <button onClick={() => handleRevokeInvite(invite.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        </div>
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
        <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {ownerAvatarUrl ? (
            <img src={ownerAvatarUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#333' }} />
          )}
          <strong>{ownerName || 'Unknown'}</strong> ({ownerStatus}) (Owner)
        </li>
        {members.map((member) => (
          <li key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {member.expand?.user?.avatar ? (
              <img src={pb.files.getURL(member.expand.user, member.expand.user.avatar, { thumb: '32x32' })} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#333' }} />
            )}
            {member.expand?.user?.name || 'Unknown'} ({member.expand?.user?.status === 'invisible' ? 'offline' : (member.expand?.user?.status || 'online')}) — {member.role}
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