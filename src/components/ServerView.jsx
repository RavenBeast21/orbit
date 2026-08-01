import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import ChannelView from './ChannelView'
import VoiceChannel from './VoiceChannel'
import RolesManager from './RolesManager'
import ChannelPermissions from './ChannelPermissions'
import CategoryPermissions from './CategoryPermissions'
import { hasPermission, hasChannelPermission, hasCategoryPermission } from '../permissions'

function ServerView({ server, onBack, setActiveConversation }) {
  const [showRolesManager, setShowRolesManager] = useState(false)
  const [permissionsChannel, setPermissionsChannel] = useState(null)
  const [permissionsCategory, setPermissionsCategory] = useState(null)
  const [canManageRoles, setCanManageRoles] = useState(false)
  const [canManageChannels, setCanManageChannels] = useState(false)
  const [canKickMembers, setCanKickMembers] = useState(false)
  const [canBanMembers, setCanBanMembers] = useState(false)
  const [canTimeoutMembers, setCanTimeoutMembers] = useState(false)
  const [channels, setChannels] = useState([])
  const [visibleChannels, setVisibleChannels] = useState([])
  const [channelManageAccess, setChannelManageAccess] = useState({})
  const [categories, setCategories] = useState([])
  const [categoryManageAccess, setCategoryManageAccess] = useState({})
  const [collapsedCategories, setCollapsedCategories] = useState(new Set())
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false)
  const [channelName, setChannelName] = useState('')
  const [channelType, setChannelType] = useState('text')
  const [channelCategoryId, setChannelCategoryId] = useState('')
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
      if (inviteMaxUses.trim()) data.max_users = Number(inviteMaxUses)
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

      const visibilityChecks = await Promise.all(
        records.map((c) => hasChannelPermission(uid, server, c, 'view_channel'))
      )
      setVisibleChannels(records.filter((_, i) => visibilityChecks[i]))

      const manageChecks = await Promise.all(
        records.map((c) => hasChannelPermission(uid, server, c, 'manage_channels'))
      )
      const manageMap = {}
      records.forEach((c, i) => { manageMap[c.id] = manageChecks[i] })
      setChannelManageAccess(manageMap)
    } catch (err) {
      console.error(err)
    }
  }

  const loadCategories = async () => {
    try {
      const records = await pb.collection('categories').getFullList({
        filter: `server="${server.id}"`,
      })
      records.sort((a, b) => a.position - b.position)
      setCategories(records)

      const manageChecks = await Promise.all(
        records.map((c) => hasCategoryPermission(uid, server, c, 'manage_channels'))
      )
      const manageMap = {}
      records.forEach((c, i) => { manageMap[c.id] = manageChecks[i] })
      setCategoryManageAccess(manageMap)
    } catch (err) {
      console.error('Load categories error:', err)
    }
  }

  const toggleCategoryCollapsed = (categoryId) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }

  const handleCreateCategory = async () => {
    setCategoryError('')

    if (!categoryName.trim()) {
      setCategoryError('Category name is required')
      return
    }

    try {
      await pb.collection('categories').create({
        name: categoryName.trim(),
        server: server.id,
        position: categories.length + 1,
      })
      setCategoryName('')
      setShowCreateCategory(false)
      loadCategories()
    } catch (err) {
      console.error('Create category error:', err)
      setCategoryError(err.message || 'Something went wrong creating that category')
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
    loadCategories()
    loadMembers()
    loadOwnerName()
    hasPermission(uid, server, 'manage_roles').then(setCanManageRoles)
    hasPermission(uid, server, 'manage_channels').then(setCanManageChannels)
    hasPermission(uid, server, 'kick_members').then(setCanKickMembers)
    hasPermission(uid, server, 'ban_members').then(setCanBanMembers)
    hasPermission(uid, server, 'timeout_members').then(setCanTimeoutMembers)

    let unsubMembers
    let unsubUsers
    let unsubCategories

    pb.collection('categories').subscribe('*', (e) => {
      if (e.record.server !== server.id) return
      loadCategories()
    }).then((fn) => {
      unsubCategories = fn
    })

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
      if (unsubCategories) unsubCategories()
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
        category: channelCategoryId || null,
      })

      setSuccessMessage('Channel successfully created')
      setChannelName('')
      setChannelType('text')
      setChannelCategoryId('')
      setShowCreateChannelModal(false)
      loadChannels()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong creating the channel')
    } finally {
      setLoading(false)
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

  const handleKick = async (memberId) => {
    try {
      await pb.collection('members').delete(memberId)
    } catch (err) {
      console.error('Kick error:', err)
    }
  }

  const handleBan = async (member) => {
    try {
      await pb.collection('bans').create({
        user: member.user,
        server: server.id,
        banned_by: uid,
        reason: '',
      })
      await pb.collection('members').delete(member.id)
    } catch (err) {
      console.error('Ban error:', err)
    }
  }

  const handleTimeout = async (memberId) => {
    try {
      const until = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now
      await pb.collection('members').update(memberId, {
        timed_out_until: until.toISOString(),
      })
    } catch (err) {
      console.error('Timeout error:', err)
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
    return (
      <VoiceChannel
        channel={activeChannel}
        onBack={() => setActiveChannel(null)}
        members={members}
        ownerName={ownerName}
        ownerStatus={ownerStatus}
        ownerAvatarUrl={ownerAvatarUrl}
      />
    )
  }

  if (activeChannel) {
    return (
      <ChannelView
        channel={activeChannel}
        server={server}
        onBack={() => setActiveChannel(null)}
        setActiveConversation={setActiveConversation}
        members={members}
        ownerName={ownerName}
        ownerStatus={ownerStatus}
        ownerAvatarUrl={ownerAvatarUrl}
      />
    )
  }

  if (showRolesManager) {
    return <RolesManager server={server} onClose={() => setShowRolesManager(false)} />
  }

  if (permissionsChannel) {
    return (
      <ChannelPermissions
        channel={permissionsChannel}
        server={server}
        onClose={() => {
          setPermissionsChannel(null)
          loadChannels()
        }}
      />
    )
  }

  if (permissionsCategory) {
    return (
      <CategoryPermissions
        category={permissionsCategory}
        server={server}
        onClose={() => {
          setPermissionsCategory(null)
          loadCategories()
          loadChannels()
        }}
      />
    )
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

      {(isOwner || canManageRoles) && (
        <div>
          <hr />
          <button onClick={() => setShowRolesManager(true)}>Manage Roles</button>
        </div>
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
      {categoryError && <p style={{ color: 'red' }}>{categoryError}</p>}

      {(() => {
        const uncategorized = visibleChannels.filter((c) => !c.category)
        const renderChannel = (channel) => (
          <li key={channel.id}>
            <button onClick={() => setActiveChannel(channel)}>
              {channel.type === 'voice' ? '🔊' : '#'} {channel.name}
            </button>
            {' '}
            {(isOwner || canManageChannels || channelManageAccess[channel.id]) && (
              <button onClick={() => setPermissionsChannel(channel)}>⚙ Settings</button>
            )}
          </li>
        )

        return (
          <>
            {uncategorized.length > 0 && (
              <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                {uncategorized.map(renderChannel)}
              </ul>
            )}

            {categories.map((category) => {
              const categoryChannels = visibleChannels.filter((c) => c.category === category.id)
              const isCollapsed = collapsedCategories.has(category.id)

              return (
                <div key={category.id} style={{ marginTop: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      onClick={() => toggleCategoryCollapsed(category.id)}
                      style={{ cursor: 'pointer', fontWeight: 'bold', flex: 1 }}
                    >
                      {isCollapsed ? '▶' : '▼'} {category.name.toUpperCase()}
                    </span>

                    {(isOwner || canManageChannels || categoryManageAccess[category.id]) && (
                      <>
                        <button
                          onClick={() => {
                            setChannelCategoryId(category.id)
                            setShowCreateChannelModal(true)
                          }}
                        >
                          +
                        </button>
                        <button onClick={() => setPermissionsCategory(category)}>⚙</button>
                      </>
                    )}
                  </div>

                  {!isCollapsed && (
                    <ul style={{ listStyle: 'none', paddingLeft: '16px' }}>
                      {categoryChannels.map(renderChannel)}
                      {categoryChannels.length === 0 && (
                        <li style={{ color: 'gray', fontSize: '0.9em' }}>No channels in this category.</li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })}

            {visibleChannels.length === 0 && <p>No channels yet.</p>}
          </>
        )
      })()}

      {(isOwner || canManageChannels) && (
        <div style={{ marginTop: '12px' }}>
          {!showCreateCategory && (
            <button onClick={() => setShowCreateCategory(true)}>+ Add Category</button>
          )}
          {showCreateCategory && (
            <div>
              <input
                type="text"
                placeholder="New Category"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
              />
              <button onClick={handleCreateCategory}>Save</button>
              <button onClick={() => { setShowCreateCategory(false); setCategoryName(''); setCategoryError('') }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {(isOwner || canManageChannels) && (
        <button
          onClick={() => {
            setChannelCategoryId('')
            setShowCreateChannelModal(true)
          }}
        >
          Create Channel
        </button>
      )}

      {showCreateChannelModal && (
        <div
          onClick={() => setShowCreateChannelModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '24px',
              width: '360px',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Create Channel</h2>
            {channelCategoryId && (
              <p style={{ color: 'gray', marginTop: '-8px' }}>
                in {categories.find((c) => c.id === channelCategoryId)?.name || 'category'}
              </p>
            )}

            <form onSubmit={handleCreateChannel}>
              <div style={{ marginBottom: '12px' }}>
                <label>Channel Type</label>
                <br />
                <label style={{ marginRight: '16px' }}>
                  <input
                    type="radio"
                    name="channelType"
                    value="text"
                    checked={channelType === 'text'}
                    onChange={() => setChannelType('text')}
                  />
                  {' '}# Text
                </label>
                <label>
                  <input
                    type="radio"
                    name="channelType"
                    value="voice"
                    checked={channelType === 'voice'}
                    onChange={() => setChannelType('voice')}
                  />
                  {' '}🔊 Voice
                </label>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label>Channel Name</label>
                <br />
                <input
                  type="text"
                  autoFocus
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label>Category</label>
                <br />
                <select value={channelCategoryId} onChange={(e) => setChannelCategoryId(e.target.value)}>
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              {error && <p style={{ color: 'red' }}>{error}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setShowCreateChannelModal(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Channel'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
            {member.expand?.user?.name || 'Unknown'} ({member.expand?.user?.status === 'invisible' ? 'offline' : (member.expand?.user?.status || 'online')})
            {' '}
            {(isOwner || canKickMembers) && (
              <button onClick={() => handleKick(member.id)} style={{ color: 'orange' }}>
                Kick
              </button>
            )}
            {' '}
            {(isOwner || canBanMembers) && (
              <button onClick={() => handleBan(member)} style={{ color: 'red' }}>
                Ban
              </button>
            )}
            {' '}
            {(isOwner || canTimeoutMembers) && (
              <button onClick={() => handleTimeout(member.id)} style={{ color: 'yellow' }}>
                Timeout (10m)
              </button>
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