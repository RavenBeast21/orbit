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

const DEFAULT_ROLE_COLOUR = '#99aab5'

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
  const [editDisplaySeparately, setEditDisplaySeparately] = useState(false)
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
        requestKey: null, // this fires alongside loadAllServerMembers/loadOwnerUser and
        // other components' own subscription-triggered reloads (e.g.
        // MembersSidebar) — without this, PocketBase's SDK auto-cancels
        // one of these near-simultaneous requests, which was silently
        // dropping the role-editor's own refresh after a save.
      })
      records.sort((a, b) => b.position - a.position)
      setRoles(records)

      const counts = {}
      for (const role of records) {
        const links = await pb.collection('member_roles').getFullList({
          filter: `role="${role.id}"`,
          requestKey: null,
        })
        counts[role.id] = links.length
      }
      setMemberCounts(counts)
    } catch (err) {
      console.error('Load roles error:', err)
      setError('Something went wrong loading roles')
    }
  }

  const [ownerUser, setOwnerUser] = useState(null)

  const loadAllServerMembers = async () => {
    try {
      const records = await pb.collection('members').getFullList({
        filter: `server="${server.id}"`,
        expand: 'user',
        requestKey: null,
      })
      setAllServerMembers(records)
    } catch (err) {
      console.error('Load server members error:', err)
    }
  }

  const loadOwnerUser = async () => {
    try {
      const user = await pb.collection('users').getOne(server.owner, { requestKey: null })
      setOwnerUser(user)
    } catch (err) {
      console.error('Load owner user error:', err)
    }
  }

  useEffect(() => {
    loadRoles()
    loadAllServerMembers()
    loadOwnerUser()
  }, [])

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null

  useEffect(() => {
    if (!selectedRole) return

    setEditName(selectedRole.name)
    setEditColour((selectedRole.colour || DEFAULT_ROLE_COLOUR).toLowerCase())
    setEditDisplaySeparately(!!selectedRole.display_separately)

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
        requestKey: null,
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

  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  const handleDrop = async (targetIndex) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }

    // Reorder within the FULL sorted role list, not the filtered/searched
    // view — reordering while a search filter hides some roles would
    // otherwise leave their positions stale relative to the moved ones.
    const fullSorted = [...roles].sort((a, b) => b.position - a.position)
    const draggedRole = filteredRoles[dragIndex]
    const targetRole = filteredRoles[targetIndex]

    const fromIndex = fullSorted.findIndex((r) => r.id === draggedRole.id)
    const toIndex = fullSorted.findIndex((r) => r.id === targetRole.id)

    const reordered = [...fullSorted]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)

    setDragIndex(null)
    setDragOverIndex(null)

    try {
      // Highest position = highest rank = top of the list, matching the
      // existing b.position - a.position sort used everywhere else.
      // Only write the roles whose position actually changed.
      const updates = reordered.map((role, i) => ({
        id: role.id,
        newPosition: reordered.length - i,
      })).filter((u) => {
        const original = fullSorted.find((r) => r.id === u.id)
        return original.position !== u.newPosition
      })

      await Promise.all(
        updates.map((u) => pb.collection('roles').update(u.id, { position: u.newPosition }))
      )
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
        display_separately: editDisplaySeparately,
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
      let realMemberId = memberId

      if (memberId === 'owner-pseudo') {
        // The owner has no row in `members` by default (they're tracked
        // separately via servers.owner, not membership) — roles can only
        // attach to a real members row, so create one for them the first
        // time they're given a role. loadMembers() elsewhere filters this
        // row back OUT of every normal member-list display, so this never
        // makes the owner show up as a duplicate regular member anywhere
        // — it exists purely so member_roles has something to point at.
        const existing = await pb.collection('members').getFullList({
          filter: `server="${server.id}" && user="${server.owner}"`,
        })
        if (existing[0]) {
          realMemberId = existing[0].id
        } else {
          const created = await pb.collection('members').create({
            server: server.id,
            user: server.owner,
          })
          realMemberId = created.id
        }
        await loadAllServerMembers()
      }

      await pb.collection('member_roles').create({
        member: realMemberId,
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
  const ownerAlreadyHasRole = roleMembers.some((link) => link.expand?.member?.user === server.owner)

  const availableMembersToAdd = allServerMembers.filter(
    (m) => !memberIdsWithRole.has(m.id) &&
      m.user !== server.owner && // owner's own lazily-created row (if any) is handled via the pseudo-entry below, not listed twice
      (m.expand?.user?.name || '').toLowerCase().includes(memberSearch.toLowerCase())
  )

  if (
    ownerUser &&
    !ownerAlreadyHasRole &&
    ownerUser.name.toLowerCase().includes(memberSearch.toLowerCase())
  ) {
    availableMembersToAdd.unshift({
      id: 'owner-pseudo',
      user: server.owner,
      expand: { user: ownerUser },
    })
  }

  // -------------------------------------------------------------
  // ROLE EDITOR VIEW
  // -------------------------------------------------------------
  if (selectedRole) {
    return (
      <div className="panel">
        <button onClick={() => setSelectedRoleId(null)}>← Back to Roles</button>
        <h2>Edit Role: {selectedRole.name}</h2>

        <div className="tab-row">
          <button className={activeTab === 'display' ? 'tab-active' : ''} onClick={() => setActiveTab('display')} disabled={activeTab === 'display'}>Display</button>
          <button className={activeTab === 'permissions' ? 'tab-active' : ''} onClick={() => setActiveTab('permissions')} disabled={activeTab === 'permissions'}>Permissions</button>
          <button className={activeTab === 'members' ? 'tab-active' : ''} onClick={() => setActiveTab('members')} disabled={activeTab === 'members'}>Members ({memberCounts[selectedRole.id] || 0})</button>
        </div>

        <hr />

        {activeTab === 'display' && (
          <div>
            <p style={{ color: 'var(--text)' }}>Nothing here yet — more display options are coming later.</p>

            <div className="form-field">
              <label>Role name</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>

            <div className="form-field">
              <label>Role colour</label>
              <br />
              <input type="color" value={editColour} onChange={(e) => setEditColour(e.target.value)} />
            </div>

            <hr />

            <div className="form-field" style={{ maxWidth: 'none' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span>Display role members separately from online members</span>
                <input
                  type="checkbox"
                  checked={editDisplaySeparately}
                  onChange={(e) => setEditDisplaySeparately(e.target.checked)}
                />
              </label>
              <p style={{ color: 'var(--text)', fontSize: '0.85em', margin: '4px 0 0' }}>
                Members with this role get their own group at the top of the member list, in role order — highest role first.
              </p>
            </div>

            <button className="btn-primary" onClick={handleSaveRole} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {activeTab === 'permissions' && (
          <div>
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.title} style={{ marginBottom: '16px' }}>
                <h3>{group.title}</h3>
                {group.permissions.map(([key, label, description]) => (
                  <div key={key} className="permission-row">
                    <input
                      type="checkbox"
                      checked={!!editPerms[key]}
                      onChange={() => togglePermission(key)}
                      id={`perm-${key}`}
                    />
                    <label htmlFor={`perm-${key}`}>
                      <strong>{label}</strong>
                      <br />
                      <span style={{ color: 'var(--text)', fontSize: '0.9em' }}>{description}</span>
                    </label>
                  </div>
                ))}
              </div>
            ))}
            <button className="btn-primary" onClick={handleSaveRole} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {activeTab === 'members' && (
          <div>
            <div className="inline-form" style={{ marginBottom: '10px' }}>
              <input
                type="text"
                placeholder="Search members with this role"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
              <button onClick={() => setShowAddMembers(!showAddMembers)}>
                {showAddMembers ? 'Cancel' : 'Add Members'}
              </button>
            </div>

            {showAddMembers && (
              <div style={{ marginBottom: '16px' }}>
                <h4>Add a member to this role:</h4>
                {availableMembersToAdd.length === 0 && <p style={{ color: 'var(--text)' }}>No matching members to add.</p>}
                <ul className="list-reset">
                  {availableMembersToAdd.map((m) => (
                    <li key={m.id} className="list-row">
                      <span>{m.expand?.user?.name || 'Unknown'}</span>
                      <button className="btn-primary" onClick={() => handleAddMember(m.id)}>Add</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <h4>Members with this role:</h4>
            {roleMembers.length === 0 && <p style={{ color: 'var(--text)' }}>No members have this role yet.</p>}
            <ul className="list-reset">
              {roleMembers
                .filter((link) => (link.expand?.member?.expand?.user?.name || '').toLowerCase().includes(memberSearch.toLowerCase()))
                .map((link) => (
                  <li key={link.id} className="list-row">
                    <span>
                      {link.expand?.member?.expand?.user?.name || 'Unknown'}
                      {link.expand?.member?.user === server.owner && ' 👑'}
                    </span>
                    <button onClick={() => handleRemoveMember(link.id)}>✕</button>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <hr />
        <button className="btn-danger" onClick={() => handleDeleteRole(selectedRole.id)}>
          Delete Role
        </button>
      </div>
    )
  }

  // -------------------------------------------------------------
  // ROLE LIST VIEW
  // -------------------------------------------------------------
  return (
    <div className="panel">
      <h2>Roles</h2>
      <p style={{ color: 'var(--text)' }}>Use roles to group your server members and assign permissions.</p>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="inline-form">
        <input
          type="text"
          placeholder="Search Roles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!showNewRoleInput && (
          <button className="btn-primary" onClick={() => setShowNewRoleInput(true)}>Create Role</button>
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
            <button className="btn-primary" onClick={handleCreateRole} disabled={creating}>
              {creating ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setShowNewRoleInput(false); setNewRoleName('') }}>
              Cancel
            </button>
          </>
        )}
      </div>

      <p style={{ color: 'var(--text)', fontSize: '0.9em' }}>
        Members use the colour of the highest role they hold. {search.trim() ? 'Clear the search to drag-reorder roles.' : 'Drag roles to reorder — higher roles outrank lower ones.'}
      </p>

      <ul className="list-reset">
        {filteredRoles.map((role, index) => (
          <li
            key={role.id}
            className={`list-row role-drag-row${dragOverIndex === index ? ' role-drag-row-over' : ''}`}
            draggable={!search.trim()}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index) }}
            onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
            onDrop={(e) => { e.preventDefault(); handleDrop(index) }}
            onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
          >
            {!search.trim() && <span className="role-drag-handle">⠿</span>}
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: role.colour || DEFAULT_ROLE_COLOUR, display: 'inline-block', flexShrink: 0 }} />
            <button onClick={() => setSelectedRoleId(role.id)} style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', padding: '4px' }}>
              {role.name}
            </button>
            <span style={{ color: 'var(--text)', fontSize: '0.85em' }}>{memberCounts[role.id] || 0} members</span>
          </li>
        ))}
      </ul>

      {filteredRoles.length === 0 && <p style={{ color: 'var(--text)' }}>No roles yet — create one to get started.</p>}
    </div>
  )
}

export default RolesManager