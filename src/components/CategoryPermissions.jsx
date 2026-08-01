import { useState, useEffect } from 'react'
import pb from '../pocketbase'

const PERMISSION_GROUPS = [
  {
    title: 'Visibility',
    permissions: [
      { key: 'view_channel', label: 'View Channel', desc: 'Can see and open channels in this category at all' },
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
      { key: 'send_messages', label: 'Send Messages', desc: 'Send messages in channels in this category' },
      { key: 'manage_messages', label: 'Manage Messages', desc: "Delete other members' messages" },
      { key: 'read_message_history', label: 'Read Message History', desc: 'See messages sent before joining/viewing' },
      { key: 'attach_files', label: 'Attach Files', desc: 'Upload files/images' },
      { key: 'mention_everyone', label: 'Mention Everyone', desc: 'Use @everyone/@here style mentions' },
    ],
  },
  {
    title: 'Voice',
    permissions: [
      { key: 'join_voice', label: 'Join Voice', desc: 'Join voice channels in this category' },
      { key: 'speak_in_voice', label: 'Speak in Voice', desc: 'Talk in voice channels in this category' },
      { key: 'share_video', label: 'Share Video', desc: 'Share camera/screen in voice channels in this category' },
      { key: 'mute_move_members', label: 'Mute/Move Members', desc: 'Mute or move other members in voice' },
    ],
  },
]

function CategoryPermissions({ category, server, onClose }) {
  const [activeTab, setActiveTab] = useState('overview')

  // Overview tab state
  const [name, setName] = useState(category.name)
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [overviewSuccess, setOverviewSuccess] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Permissions tab state
  const [roles, setRoles] = useState([])
  const [categoryRoleLinks, setCategoryRoleLinks] = useState([])
  const [selectedRoleId, setSelectedRoleId] = useState(null)
  const [overwrites, setOverwrites] = useState([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [permError, setPermError] = useState('')
  const [savingKey, setSavingKey] = useState(null)
  const [showAddRole, setShowAddRole] = useState(false)
  const [addRoleError, setAddRoleError] = useState('')

  const hasUnsavedOverviewChanges = name !== category.name

  const categoryRoles = categoryRoleLinks
    .map((link) => link.expand?.role)
    .filter(Boolean)

  const availableRolesToAdd = roles.filter(
    (role) => !categoryRoleLinks.some((link) => link.role === role.id)
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

  const loadCategoryRoleLinks = async () => {
    try {
      const records = await pb.collection('category_role_permissions').getFullList({
        filter: `category="${category.id}"`,
        expand: 'role',
      })
      setCategoryRoleLinks(records)
      setSelectedRoleId((prev) => {
        if (prev && records.some((r) => r.role === prev)) return prev
        return records.length > 0 ? records[0].role : null
      })
    } catch (err) {
      console.error('Load category role links error:', err)
      setPermError('Failed to load this category\'s role list')
    }
  }

  const loadOverwrites = async () => {
    try {
      const records = await pb.collection('category_overwrites').getFullList({
        filter: `category="${category.id}"`,
      })
      setOverwrites(records)
    } catch (err) {
      console.error('Load overwrites error:', err)
      setPermError('Failed to load category overwrites')
    }
  }

  useEffect(() => {
    setRolesLoading(true)
    Promise.all([loadRoles(), loadCategoryRoleLinks(), loadOverwrites()]).finally(() => setRolesLoading(false))

    let unsubOverwrites
    let unsubCategoryRoleLinks

    pb.collection('category_overwrites').subscribe('*', (e) => {
      if (e.record.category !== category.id) return
      loadOverwrites()
    }).then((fn) => {
      unsubOverwrites = fn
    })

    pb.collection('category_role_permissions').subscribe('*', (e) => {
      if (e.record.category !== category.id) return
      loadCategoryRoleLinks()
    }).then((fn) => {
      unsubCategoryRoleLinks = fn
    })

    return () => {
      if (unsubOverwrites) unsubOverwrites()
      if (unsubCategoryRoleLinks) unsubCategoryRoleLinks()
    }
  }, [category.id])

  const handleSaveOverview = async () => {
    setOverviewError('')
    setOverviewSuccess('')

    if (!name.trim()) {
      setOverviewError('Category name is required')
      return
    }

    setOverviewSaving(true)
    try {
      await pb.collection('categories').update(category.id, { name: name.trim() })
      setOverviewSuccess('Saved')
    } catch (err) {
      console.error('Save category error:', err)
      setOverviewError(err.message || 'Something went wrong saving these changes')
    } finally {
      setOverviewSaving(false)
    }
  }

  const handleDeleteCategory = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      const affectedChannels = await pb.collection('channels').getFullList({
        filter: `category="${category.id}"`,
      })
      await Promise.all(
        affectedChannels.map((c) => pb.collection('channels').update(c.id, { category: null }))
      )

      await pb.collection('categories').delete(category.id)
      onClose()
    } catch (err) {
      console.error('Delete category error:', err)
      setDeleteError(err.message || 'Something went wrong deleting this category')
      setDeleting(false)
    }
  }

  const getOverwrite = (roleId, permission) => {
    return overwrites.find((o) => o.role === roleId && o.permission === permission) || null
  }

  const handleAddRoleToCategory = async (roleId) => {
    setAddRoleError('')

    if (categoryRoleLinks.some((link) => link.role === roleId)) {
      setAddRoleError('Role has already been added to this category')
      return
    }

    try {
      await pb.collection('category_role_permissions').create({
        category: category.id,
        role: roleId,
      })
      setSelectedRoleId(roleId)
      setShowAddRole(false)
      await loadCategoryRoleLinks()
    } catch (err) {
      console.error('Add role to category error:', err)
      setAddRoleError(err.message || 'Something went wrong adding that role')
    }
  }

  const handleRemoveRoleFromCategory = async (roleId) => {
    setPermError('')
    try {
      const link = categoryRoleLinks.find((l) => l.role === roleId)
      if (link) {
        await pb.collection('category_role_permissions').delete(link.id)
      }

      const relatedOverwrites = overwrites.filter((o) => o.role === roleId)
      await Promise.all(
        relatedOverwrites.map((o) => pb.collection('category_overwrites').delete(o.id))
      )

      if (selectedRoleId === roleId) {
        setSelectedRoleId(null)
      }

      await Promise.all([loadCategoryRoleLinks(), loadOverwrites()])
    } catch (err) {
      console.error('Remove role from category error:', err)
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
          await pb.collection('category_overwrites').delete(existing.id)
        }
      } else if (existing) {
        await pb.collection('category_overwrites').update(existing.id, { allow: value })
      } else {
        await pb.collection('category_overwrites').create({
          category: category.id,
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

  const selectedRole = categoryRoles.find((r) => r.id === selectedRoleId) || null

  return (
    <div style={{ display: 'flex', minHeight: '80vh' }}>
      {/* Outer sidebar */}
      <div style={{ width: '220px', borderRight: '1px solid #333', padding: '16px' }}>
        <div style={{ fontSize: '0.8em', color: 'gray', textTransform: 'uppercase' }}>
          Category
        </div>
        <h2 style={{ marginTop: '4px' }}>{name || category.name}</h2>

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
            Delete Category
          </button>
        )}

        {showDeleteConfirm && (
          <div>
            <p style={{ fontSize: '0.9em' }}>
              Delete <strong>{category.name}</strong>? Its channels will become uncategorized, not deleted.
            </p>
            <button style={{ color: 'red' }} disabled={deleting} onClick={handleDeleteCategory}>
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
              <label>Category Name</label>
              <br />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              Select a role, then set Allow, Neutral, or Deny for each permission in this category.
              Channels in this category automatically use these settings unless a channel has its own
              explicit override for that specific permission.
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
                          Every role has already been added to this category.
                        </p>
                      )}
                      {availableRolesToAdd.map((role) => (
                        <div
                          key={role.id}
                          onClick={() => handleAddRoleToCategory(role.id)}
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

                  {categoryRoles.length === 0 && !showAddRole && (
                    <p style={{ fontSize: '0.85em', color: 'gray' }}>
                      No roles added to this category yet. Click + Add Role to configure one.
                    </p>
                  )}

                  {categoryRoles.map((role) => (
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
                        title="Remove from this category"
                        onClick={() => handleRemoveRoleFromCategory(role.id)}
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

export default CategoryPermissions