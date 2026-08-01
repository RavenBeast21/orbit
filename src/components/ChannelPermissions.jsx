import { useState, useEffect } from 'react'
import pb from '../pocketbase'

const PERMISSION_GROUPS = [
  {
    title: 'Visibility',
    permissions: [
      { key: 'view_channel', label: 'View Channel', desc: 'Can see and open this channel at all' },
    ],
  },
  {
    title: 'Server Controls',
    permissions: [
      { key: 'manage_server', label: 'Manage Server', desc: 'Edit server settings' },
      { key: 'manage_roles', label: 'Manage Roles', desc: 'Create/edit/assign roles' },
      { key: 'manage_channels', label: 'Manage Channels', desc: 'Create/edit/delete/reorder channels' },
      { key: 'manage_invites', label: 'Manage Invites', desc: 'Create/revoke invite links' },
      { key: 'view_activity_log', label: 'View Activity Log', desc: '(Stretch goal — no log built yet)' },
    ],
  },
  {
    title: 'Member Controls',
    permissions: [
      { key: 'kick_members', label: 'Kick Members', desc: 'Remove members from the server' },
      { key: 'ban_members', label: 'Ban Members', desc: 'Ban members from the server' },
      { key: 'timeout_members', label: 'Timeout Members', desc: 'Temporarily prevent a member from sending messages' },
      { key: 'approve_join_requests', label: 'Approve Join Requests', desc: '(Stretch goal — no join-approval system built yet)' },
    ],
  },
  {
    title: 'Messaging',
    permissions: [
      { key: 'send_messages', label: 'Send Messages', desc: 'Send messages in this channel' },
      { key: 'manage_messages', label: 'Manage Messages', desc: "Delete other members' messages" },
      { key: 'read_message_history', label: 'Read Message History', desc: 'See messages sent before joining/viewing' },
      { key: 'attach_files', label: 'Attach Files', desc: 'Upload files/images' },
      { key: 'mention_everyone', label: 'Mention Everyone', desc: 'Use @everyone/@here style mentions' },
    ],
  },
  {
    title: 'Voice',
    permissions: [
      { key: 'join_voice', label: 'Join Voice', desc: 'Join this voice channel' },
      { key: 'speak_in_voice', label: 'Speak in Voice', desc: 'Talk in this voice channel' },
      { key: 'share_video', label: 'Share Video', desc: 'Share camera/screen in this voice channel' },
      { key: 'mute_move_members', label: 'Mute/Move Members', desc: 'Mute or move other members in voice' },
    ],
  },
]

function ChannelPermissions({ channel, server, onClose }) {
  const [activeTab, setActiveTab] = useState('overview')

  // Overview tab state
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic || '')
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [overviewSuccess, setOverviewSuccess] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Permissions tab state
  const [roles, setRoles] = useState([])
  const [channelRoleLinks, setChannelRoleLinks] = useState([]) // channel_role_permissions rows, expanded with role
  const [selectedRoleId, setSelectedRoleId] = useState(null)
  const [overwrites, setOverwrites] = useState([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [permError, setPermError] = useState('')
  const [savingKey, setSavingKey] = useState(null)
  const [showAddRole, setShowAddRole] = useState(false)
  const [addRoleError, setAddRoleError] = useState('')

  const hasUnsavedOverviewChanges = name !== channel.name || topic !== (channel.topic || '')

  const channelRoles = channelRoleLinks
    .map((link) => link.expand?.role)
    .filter(Boolean)

  const availableRolesToAdd = roles.filter(
    (role) => !channelRoleLinks.some((link) => link.role === role.id)
  )

  const loadRoles = async () => {
    try {
      const records = await pb.collection('roles').getFullList({
        filter: `server="${server.id}"`,
      })
      records.sort((a, b) => b.position - a.position)
      setRoles(records)
    } catch (err) {
      console.error('Load roles error:', err)
      setPermError('Failed to load roles')
    }
  }

  const loadChannelRoleLinks = async () => {
    try {
      const records = await pb.collection('channel_role_permissions').getFullList({
        filter: `channel="${channel.id}"`,
        expand: 'role',
      })
      setChannelRoleLinks(records)
      setSelectedRoleId((prev) => {
        if (prev && records.some((r) => r.role === prev)) return prev
        return records.length > 0 ? records[0].role : null
      })
    } catch (err) {
      console.error('Load channel role links error:', err)
      setPermError('Failed to load this channel\'s role list')
    }
  }

  const loadOverwrites = async () => {
    try {
      const records = await pb.collection('channel_overwrites').getFullList({
        filter: `channel="${channel.id}"`,
      })
      setOverwrites(records)
    } catch (err) {
      console.error('Load overwrites error:', err)
      setPermError('Failed to load channel overwrites')
    }
  }

  useEffect(() => {
    setRolesLoading(true)
    Promise.all([loadRoles(), loadChannelRoleLinks(), loadOverwrites()]).finally(() => setRolesLoading(false))

    let unsubOverwrites
    let unsubChannelRoleLinks

    pb.collection('channel_overwrites').subscribe('*', (e) => {
      if (e.record.channel !== channel.id) return
      loadOverwrites()
    }).then((fn) => {
      unsubOverwrites = fn
    })

    pb.collection('channel_role_permissions').subscribe('*', (e) => {
      if (e.record.channel !== channel.id) return
      loadChannelRoleLinks()
    }).then((fn) => {
      unsubChannelRoleLinks = fn
    })

    return () => {
      if (unsubOverwrites) unsubOverwrites()
      if (unsubChannelRoleLinks) unsubChannelRoleLinks()
    }
  }, [channel.id])

  const handleSaveOverview = async () => {
    setOverviewError('')
    setOverviewSuccess('')

    if (!name.trim()) {
      setOverviewError('Channel name is required')
      return
    }

    setOverviewSaving(true)
    try {
      await pb.collection('channels').update(channel.id, {
        name: name.trim(),
        topic: topic.trim(),
      })
      setOverviewSuccess('Saved')
    } catch (err) {
      console.error('Save channel error:', err)
      setOverviewError(err.message || 'Something went wrong saving these changes')
    } finally {
      setOverviewSaving(false)
    }
  }

  const handleDeleteChannel = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      await pb.collection('channels').delete(channel.id)
      onClose()
    } catch (err) {
      console.error('Delete channel error:', err)
      setDeleteError(err.message || 'Something went wrong deleting this channel')
      setDeleting(false)
    }
  }

  const getOverwrite = (roleId, permission) => {
    return overwrites.find((o) => o.role === roleId && o.permission === permission) || null
  }

  const handleAddRoleToChannel = async (roleId) => {
    setAddRoleError('')

    if (channelRoleLinks.some((link) => link.role === roleId)) {
      setAddRoleError('Role has already been added to this channel')
      return
    }

    try {
      await pb.collection('channel_role_permissions').create({
        channel: channel.id,
        role: roleId,
      })
      setSelectedRoleId(roleId)
      setShowAddRole(false)
      await loadChannelRoleLinks()
    } catch (err) {
      console.error('Add role to channel error:', err)
      setAddRoleError(err.message || 'Something went wrong adding that role')
    }
  }

  const handleRemoveRoleFromChannel = async (roleId) => {
    setPermError('')
    try {
      const link = channelRoleLinks.find((l) => l.role === roleId)
      if (link) {
        await pb.collection('channel_role_permissions').delete(link.id)
      }

      // Clean up any overwrites for this role in this channel too — they're
      // meaningless now that the role isn't configured here anymore.
      const relatedOverwrites = overwrites.filter((o) => o.role === roleId)
      await Promise.all(
        relatedOverwrites.map((o) => pb.collection('channel_overwrites').delete(o.id))
      )

      if (selectedRoleId === roleId) {
        setSelectedRoleId(null)
      }

      await Promise.all([loadChannelRoleLinks(), loadOverwrites()])
    } catch (err) {
      console.error('Remove role from channel error:', err)
      setPermError('Something went wrong removing that role')
    }
  }

  const handleSetOverwrite = async (roleId, permission, value) => {
    const key = `${roleId}|${permission}`
    setSavingKey(key)
    setPermError('')

    try {
      const existing = getOverwrite(roleId, permission)

      if (value === null) {
        if (existing) {
          await pb.collection('channel_overwrites').delete(existing.id)
        }
      } else if (existing) {
        await pb.collection('channel_overwrites').update(existing.id, { allow: value })
      } else {
        await pb.collection('channel_overwrites').create({
          channel: channel.id,
          role: roleId,
          permission,
          allow: value,
        })
      }

      await loadOverwrites()
    } catch (err) {
      console.error('Set overwrite error:', err)
      setPermError('Something went wrong saving that permission')
    } finally {
      setSavingKey(null)
    }
  }

  const selectedRole = channelRoles.find((r) => r.id === selectedRoleId) || null

  return (
    <div style={{ display: 'flex', minHeight: '80vh' }}>
      {/* Outer sidebar */}
      <div style={{ width: '220px', borderRight: '1px solid #333', padding: '16px' }}>
        <div style={{ fontSize: '0.8em', color: 'gray', textTransform: 'uppercase' }}>
          {channel.type === 'voice' ? '🔊 Voice Channel' : '# Text Channel'}
        </div>
        <h2 style={{ marginTop: '4px' }}>{name || channel.name}</h2>

        <div style={{ marginTop: '16px' }}>
          <div
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '8px',
              cursor: 'pointer',
              backgroundColor: activeTab === 'overview' ? '#333' : 'transparent',
              borderRadius: '4px',
            }}
          >
            Overview
          </div>
          <div
            onClick={() => setActiveTab('permissions')}
            style={{
              padding: '8px',
              cursor: 'pointer',
              backgroundColor: activeTab === 'permissions' ? '#333' : 'transparent',
              borderRadius: '4px',
            }}
          >
            Permissions
          </div>
        </div>

        <hr style={{ margin: '16px 0', borderColor: '#333' }} />

        {!showDeleteConfirm && (
          <button style={{ color: 'red' }} onClick={() => setShowDeleteConfirm(true)}>
            Delete Channel
          </button>
        )}

        {showDeleteConfirm && (
          <div>
            <p style={{ fontSize: '0.9em' }}>
              Are you sure you want to delete <strong>{channel.name}</strong>? This cannot be undone.
            </p>
            <button style={{ color: 'red' }} disabled={deleting} onClick={handleDeleteChannel}>
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
            {' '}
            <button disabled={deleting} onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </button>
            {deleteError && <p style={{ color: 'red' }}>{deleteError}</p>}
          </div>
        )}

        <hr style={{ margin: '16px 0', borderColor: '#333' }} />

        <button onClick={onClose}>← Back to channel list</button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '16px' }}>
        {activeTab === 'overview' && (
          <div>
            <h1>Overview</h1>

            <div style={{ marginBottom: '16px' }}>
              <label>Channel Name</label>
              <br />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label>Channel Topic</label>
              <br />
              <textarea
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Let everyone know how to use this channel"
              />
            </div>

            <button
              disabled={!hasUnsavedOverviewChanges || overviewSaving}
              onClick={handleSaveOverview}
            >
              {overviewSaving ? 'Saving...' : 'Save Changes'}
            </button>

            {overviewError && <p style={{ color: 'red' }}>{overviewError}</p>}
            {overviewSuccess && !hasUnsavedOverviewChanges && (
              <p style={{ color: 'lightgreen' }}>{overviewSuccess}</p>
            )}
          </div>
        )}

        {activeTab === 'permissions' && (
          <div>
            <h1>Permissions</h1>
            <p style={{ color: 'gray' }}>
              Select a role, then set Allow, Neutral, or Deny for each permission in this channel only.
              Neutral means "use the server-wide setting for this role" (or, for View Channel, defaults to visible).
            </p>
            {permError && <p style={{ color: 'red' }}>{permError}</p>}

            {rolesLoading && <p>Loading roles...</p>}

            {!rolesLoading && roles.length === 0 && (
              <p>No roles created yet — create a role first in Manage Roles.</p>
            )}

            {!rolesLoading && roles.length > 0 && (
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ width: '200px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ fontSize: '0.8em', color: 'gray', textTransform: 'uppercase' }}>
                      Roles
                    </div>
                    <button onClick={() => { setShowAddRole((v) => !v); setAddRoleError('') }}>
                      + Add Role
                    </button>
                  </div>

                  {showAddRole && (
                    <div style={{ border: '1px solid #333', borderRadius: '4px', padding: '8px', marginBottom: '8px' }}>
                      {availableRolesToAdd.length === 0 && (
                        <p style={{ fontSize: '0.85em', color: 'gray' }}>
                          Every role has already been added to this channel.
                        </p>
                      )}
                      {availableRolesToAdd.map((role) => (
                        <div
                          key={role.id}
                          onClick={() => handleAddRoleToChannel(role.id)}
                          style={{
                            padding: '6px',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            color: role.colour || undefined,
                          }}
                        >
                          {role.name}
                        </div>
                      ))}
                      {addRoleError && <p style={{ color: 'red', fontSize: '0.85em' }}>{addRoleError}</p>}
                    </div>
                  )}

                  {channelRoles.length === 0 && !showAddRole && (
                    <p style={{ fontSize: '0.85em', color: 'gray' }}>
                      No roles added to this channel yet. Click + Add Role to configure one.
                    </p>
                  )}

                  {channelRoles.map((role) => (
                    <div
                      key={role.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        backgroundColor: selectedRoleId === role.id ? '#333' : 'transparent',
                      }}
                    >
                      <span onClick={() => setSelectedRoleId(role.id)} style={{ color: role.colour || undefined, flex: 1 }}>
                        {role.name}
                      </span>
                      <button
                        title="Remove from this channel"
                        onClick={() => handleRemoveRoleFromChannel(role.id)}
                        style={{ fontSize: '0.75em' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ flex: 1 }}>
                  {selectedRole && (
                    <>
                      <h2 style={{ color: selectedRole.colour || undefined }}>{selectedRole.name}</h2>

                      {PERMISSION_GROUPS.map((group) => (
                        <div key={group.title} style={{ marginBottom: '12px' }}>
                          <h3>{group.title}</h3>
                          {group.permissions.map((perm) => {
                            const overwrite = getOverwrite(selectedRole.id, perm.key)
                            const currentValue = overwrite ? overwrite.allow : null
                            const key = `${selectedRole.id}|${perm.key}`
                            const isSaving = savingKey === key

                            return (
                              <div
                                key={perm.key}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '6px 0',
                                  borderBottom: '1px solid #222',
                                }}
                              >
                                <div style={{ flex: 1 }}>
                                  <strong>{perm.label}</strong>
                                  <div style={{ fontSize: '0.85em', color: 'gray' }}>{perm.desc}</div>
                                </div>

                                <button
                                  disabled={isSaving}
                                  title="Deny"
                                  onClick={() => handleSetOverwrite(selectedRole.id, perm.key, false)}
                                  style={{
                                    width: '32px',
                                    color: currentValue === false ? 'white' : 'salmon',
                                    backgroundColor: currentValue === false ? 'darkred' : 'transparent',
                                    border: '1px solid darkred',
                                    borderRadius: '4px',
                                  }}
                                >
                                  ✕
                                </button>

                                <button
                                  disabled={isSaving}
                                  title="Neutral"
                                  onClick={() => handleSetOverwrite(selectedRole.id, perm.key, null)}
                                  style={{
                                    width: '32px',
                                    color: currentValue === null ? 'white' : 'lightgray',
                                    backgroundColor: currentValue === null ? 'gray' : 'transparent',
                                    border: '1px solid gray',
                                    borderRadius: '4px',
                                  }}
                                >
                                  —
                                </button>

                                <button
                                  disabled={isSaving}
                                  title="Allow"
                                  onClick={() => handleSetOverwrite(selectedRole.id, perm.key, true)}
                                  style={{
                                    width: '32px',
                                    color: currentValue === true ? 'white' : 'lightgreen',
                                    backgroundColor: currentValue === true ? 'green' : 'transparent',
                                    border: '1px solid green',
                                    borderRadius: '4px',
                                  }}
                                >
                                  ✓
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChannelPermissions