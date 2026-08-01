import { useState, useEffect } from 'react'
import pb from '../pocketbase'

// All permissions Orbit currently supports, grouped for display.
// Each entry: [field name in the roles collection, label, short description]
const PERMISSION_GROUPS = [
  {
    title: 'Server Controls',
    permissions: [
      ['manage_server', 'Manage Server', "Change the server's name, icon, and core settings."],
      ['manage_roles', 'Manage Roles', 'Create, edit, or delete roles ranked below this one.'],
      ['manage_channels', 'Manage Channels', 'Create, edit, delete, and reorder channels.'],
      ['manage_invites', 'Manage Invites', 'Create and revoke invite links.'],
      ['view_activity_log', 'View Activity Log', 'See a history of moderation and settings changes.'],
    ],
  },
  {
    title: 'Member Controls',
    permissions: [
      ['kick_members', 'Kick Members', 'Remove a member from the server. They can rejoin with a new invite.'],
      ['ban_members', 'Ban Members', 'Remove a member and block them from rejoining.'],
      ['timeout_members', 'Timeout Members', 'Temporarily stop a member from sending messages or speaking.'],
      ['approve_join_requests', 'Approve Join Requests', 'Approve or deny people asking to join.'],
    ],
  },
  {
    title: 'Messaging',
    permissions: [
      ['send_messages', 'Send Messages', 'Post messages in text channels.'],
      ['manage_messages', 'Manage Messages', 'Delete or pin messages sent by others.'],
      ['read_message_history', 'Read Message History', 'See messages sent before joining a channel.'],
      ['attach_files', 'Attach Files', 'Upload files or images in text channels.'],
      ['mention_everyone', 'Mention Everyone', 'Ping @everyone or @here.'],
    ],
  },
  {
    title: 'Voice',
    permissions: [
      ['join_voice', 'Join Voice', 'Connect to voice channels.'],
      ['speak_in_voice', 'Speak in Voice', 'Talk once connected. If off, the member joins muted until someone with Mute/Move Members unmutes them.'],
      ['share_video', 'Share Video', 'Turn on camera or screen share in voice.'],
      ['mute_move_members', 'Mute/Move Members', 'Mute other members in voice, or move them between voice channels.'],
    ],
  },
]

const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p[0]))

const DEFAULT_ROLE_COLOUR = '#99AAB5'

function RolesManager({ server, onClose }) {
  const [roles, setRoles] = useState([])
  const [memberCounts, setMemberCounts] = useState({})
  const [selectedRoleId, setSelectedRoleId] = useState(null)
  const [activeTab, setActiveTab] = useState('permissions')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [showNewRoleInput, setShowNewRoleInput] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')

  // Editor local state (only meaningful while a role is selected)
  const [editName, setEditName] = useState('')
  const [editColour, setEditColour] = useState(DEFAULT_ROLE_COLOUR)
  const [editPerms, setEditPerms] = useState({})
  const [saving, setSaving] = useState(false)

  // Members tab state
  const [roleMembers, setRoleMembers] = useState([])
  const [memberSearch, setMemberSearch] = useState('')
  const [allServerMembers, setAllServerMembers] = useState([])
  const [showAddMembers, setShowAddMembers] = useState(false)

  const loadRoles = async () => {
    try {
      const records = await pb.collection('roles').getFullList({
        filter: `server="${server.id}"`,
      })
      records.sort((a, b) => b.position - a.position)
      setRoles(records)

      const counts = {}
      for (const role of records) {
        const links = await pb.collection('member_roles').getFullList({
          filter: `role="${role.id}"`,
        })
        counts[role.id] = links.length
      }
      setMemberCounts(counts)
    } catch (err) {
      console.error('Load roles error:', err)
      setError('Something went wrong loading roles')
    }
  }

  const loadAllServerMembers = async () => {
    try {
      const records = await pb.collection('members').getFullList({
        filter: `server="${server.id}"`,
        expand: 'user',
      })
      setAllServerMembers(records)
    } catch (err) {
      console.error('Load server members error:', err)
    }
  }

  useEffect(() => {
    loadRoles()
    loadAllServerMembers()
  }, [])

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null

  useEffect(() => {
    if (!selectedRole) return

    setEditName(selectedRole.name)
    setEditColour(selectedRole.colour || DEFAULT_ROLE_COLOUR)

    const perms = {}
    for (const key of ALL_PERMISSION_KEYS) {
      perms[key] = !!selectedRole[key]
    }
    setEditPerms(perms)
    setActiveTab('permissions')
    loadRoleMembers(selectedRole.id)
  }, [selectedRoleId])

  const loadRoleMembers = async (roleId) => {
    try {
      const links = await pb.collection('member_roles').getFullList({
        filter: `role="${roleId}"`,
        expand: 'member,member.user',
      })
      setRoleMembers(links)
    } catch (err) {
      console.error('Load role members error:', err)
    }
  }

  const handleCreateRole = async () => {
    const trimmedName = newRoleName.trim()
    if (!trimmedName) {
      // Nothing entered — don't create anything, just quietly close the input.
      setShowNewRoleInput(false)
      setNewRoleName('')
      return
    }

    setError('')
    setCreating(true)
    try {
      const highestPosition = roles.length > 0 ? Math.max(...roles.map((r) => r.position)) : 0
      const data = {
        name: trimmedName,
        server: server.id,
        colour: DEFAULT_ROLE_COLOUR,
        position: highestPosition + 1,
      }
      for (const key of ALL_PERMISSION_KEYS) data[key] = false

      const created = await pb.collection('roles').create(data)
      await loadRoles()
      setShowNewRoleInput(false)
      setNewRoleName('')
      setSelectedRoleId(created.id)
    } catch (err) {
      console.error('Create role error:', err)
      setError(err.message || 'Something went wrong creating the role')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteRole = async (roleId) => {
    try {
      await pb.collection('roles').delete(roleId)
      if (selectedRoleId === roleId) setSelectedRoleId(null)
      await loadRoles()
    } catch (err) {
      console.error('Delete role error:', err)
      setError('Something went wrong deleting the role')
    }
  }

  const handleMoveRole = async (roleId, direction) => {
    const sorted = [...roles].sort((a, b) => b.position - a.position)
    const index = sorted.findIndex((r) => r.id === roleId)
    const swapIndex = direction === 'up' ? index - 1 : index + 1

    if (swapIndex < 0 || swapIndex >= sorted.length) return

    const a = sorted[index]
    const b = sorted[swapIndex]

    try {
      await pb.collection('roles').update(a.id, { position: b.position })
      await pb.collection('roles').update(b.id, { position: a.position })
      await loadRoles()
    } catch (err) {
      console.error('Reorder role error:', err)
    }
  }

  const handleSaveRole = async () => {
    if (!selectedRole) return
    setSaving(true)
    setError('')
    try {
      const data = {
        name: editName,
        colour: editColour,
        ...editPerms,
      }
      await pb.collection('roles').update(selectedRole.id, data)
      await loadRoles()
    } catch (err) {
      console.error('Save role error:', err)
      setError(err.message || 'Something went wrong saving the role')
    } finally {
      setSaving(false)
    }
  }

  const togglePermission = (key) => {
    setEditPerms((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleAddMember = async (memberId) => {
    if (!selectedRole) return
    try {
      await pb.collection('member_roles').create({
        member: memberId,
        role: selectedRole.id,
      })
      await loadRoleMembers(selectedRole.id)
      await loadRoles()
    } catch (err) {
      console.error('Add member to role error:', err)
    }
  }

  const handleRemoveMember = async (linkId) => {
    try {
      await pb.collection('member_roles').delete(linkId)
      if (selectedRole) {
        await loadRoleMembers(selectedRole.id)
        await loadRoles()
      }
    } catch (err) {
      console.error('Remove member from role error:', err)
    }
  }

  const filteredRoles = roles
    .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.position - a.position)

  const memberIdsWithRole = new Set(roleMembers.map((link) => link.member))
  const availableMembersToAdd = allServerMembers.filter(
    (m) => !memberIdsWithRole.has(m.id) &&
      (m.expand?.user?.name || '').toLowerCase().includes(memberSearch.toLowerCase())
  )

  // -------------------------------------------------------------
  // ROLE EDITOR VIEW
  // -------------------------------------------------------------
  if (selectedRole) {
    return (
      <div>
        <button onClick={() => setSelectedRoleId(null)}>← Back to Roles</button>
        <h2>Edit Role: {selectedRole.name}</h2>

        <div>
          <button onClick={() => setActiveTab('display')} disabled={activeTab === 'display'}>Display</button>
          {' '}
          <button onClick={() => setActiveTab('permissions')} disabled={activeTab === 'permissions'}>Permissions</button>
          {' '}
          <button onClick={() => setActiveTab('members')} disabled={activeTab === 'members'}>Members ({memberCounts[selectedRole.id] || 0})</button>
        </div>

        <hr />

        {activeTab === 'display' && (
          <div>
            <p style={{ color: 'gray' }}>Nothing here yet — more display options are coming later.</p>

            <label>Role name</label>
            <br />
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />

            <br /><br />

            <label>Role colour</label>
            <br />
            <input type="color" value={editColour} onChange={(e) => setEditColour(e.target.value)} />

            <br /><br />
            <button onClick={handleSaveRole} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {activeTab === 'permissions' && (
          <div>
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.title}>
                <h3>{group.title}</h3>
                {group.permissions.map(([key, label, description]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={!!editPerms[key]}
                      onChange={() => togglePermission(key)}
                      id={`perm-${key}`}
                    />
                    <label htmlFor={`perm-${key}`}>
                      <strong>{label}</strong>
                      <br />
                      <span style={{ color: 'gray', fontSize: '0.9em' }}>{description}</span>
                    </label>
                  </div>
                ))}
                <hr />
              </div>
            ))}
            <button onClick={handleSaveRole} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {activeTab === 'members' && (
          <div>
            <input
              type="text"
              placeholder="Search members with this role"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            {' '}
            <button onClick={() => setShowAddMembers(!showAddMembers)}>
              {showAddMembers ? 'Cancel' : 'Add Members'}
            </button>

            {showAddMembers && (
              <div>
                <h4>Add a member to this role:</h4>
                {availableMembersToAdd.length === 0 && <p style={{ color: 'gray' }}>No matching members to add.</p>}
                <ul>
                  {availableMembersToAdd.map((m) => (
                    <li key={m.id}>
                      {m.expand?.user?.name || 'Unknown'}
                      {' '}
                      <button onClick={() => handleAddMember(m.id)}>Add</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <h4>Members with this role:</h4>
            <ul>
              {roleMembers.length === 0 && <p style={{ color: 'gray' }}>No members have this role yet.</p>}
              {roleMembers
                .filter((link) => (link.expand?.member?.expand?.user?.name || '').toLowerCase().includes(memberSearch.toLowerCase()))
                .map((link) => (
                  <li key={link.id}>
                    {link.expand?.member?.expand?.user?.name || 'Unknown'}
                    {' '}
                    <button onClick={() => handleRemoveMember(link.id)}>✕</button>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <hr />
        <button onClick={() => handleDeleteRole(selectedRole.id)} style={{ color: 'red' }}>
          Delete Role
        </button>
      </div>
    )
  }

  // -------------------------------------------------------------
  // ROLE LIST VIEW
  // -------------------------------------------------------------
  return (
    <div>
      <button onClick={onClose}>← Back to Server</button>
      <h2>Roles</h2>
      <p style={{ color: 'gray' }}>Use roles to group your server members and assign permissions.</p>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div>
        <input
          type="text"
          placeholder="Search Roles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {' '}
        {!showNewRoleInput && (
          <button onClick={() => setShowNewRoleInput(true)}>Create Role</button>
        )}
        {showNewRoleInput && (
          <>
            <input
              type="text"
              placeholder="New Role"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateRole() }}
            />
            {' '}
            <button onClick={handleCreateRole} disabled={creating}>
              {creating ? 'Saving...' : 'Save'}
            </button>
            {' '}
            <button onClick={() => { setShowNewRoleInput(false); setNewRoleName('') }}>
              Cancel
            </button>
          </>
        )}
      </div>

      <p style={{ color: 'gray', fontSize: '0.9em' }}>
        Members use the colour of the highest role they hold. Use the arrows to reorder roles — higher roles outrank lower ones.
      </p>

      <ul>
        {filteredRoles.map((role, index) => (
          <li key={role.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: role.colour || DEFAULT_ROLE_COLOUR, display: 'inline-block' }} />
            <button onClick={() => setSelectedRoleId(role.id)} style={{ flex: 1, textAlign: 'left' }}>
              {role.name}
            </button>
            <span>{memberCounts[role.id] || 0} members</span>
            <button onClick={() => handleMoveRole(role.id, 'up')} disabled={index === 0}>↑</button>
            <button onClick={() => handleMoveRole(role.id, 'down')} disabled={index === filteredRoles.length - 1}>↓</button>
          </li>
        ))}
      </ul>

      {filteredRoles.length === 0 && <p>No roles yet — create one to get started.</p>}
    </div>
  )
}

export default RolesManager