import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import { getEffectiveStatus } from '../presence'
import ChannelView from './ChannelView'
import VoiceChannel from './VoiceChannel'
import RolesManager from './RolesManager'
import ChannelPermissions from './ChannelPermissions'
import CategoryPermissions from './CategoryPermissions'
import OrbitsBoost from './OrbitsBoost'
import UserPanel from './UserPanel'
import TagPicker from './TagPicker'
import { sanitizeTags } from '../serverTags'
import { hasPermission, hasChannelPermission, hasCategoryPermission } from '../permissions'
import { TOKEN_SERVER_URL } from '../config'
import { useUnread, getChannelUnread, markRead } from '../unread'

// Human labels for the server-wide role booleans, used by the "My Roles" panel.
const ROLE_PERMISSION_LABELS = {
  manage_server: 'Manage Server',
  manage_roles: 'Manage Roles',
  manage_channels: 'Manage Channels',
  manage_invites: 'Manage Invites',
  view_activity_log: 'View Activity Log',
  kick_members: 'Kick Members',
  ban_members: 'Ban Members',
  timeout_members: 'Timeout Members',
  approve_join_requests: 'Approve Join Requests',
  send_messages: 'Send Messages',
  manage_messages: 'Manage Messages',
  read_message_history: 'Read Message History',
  attach_files: 'Attach Files',
  mention_everyone: 'Mention Everyone',
  join_voice: 'Join Voice',
  speak_in_voice: 'Speak in Voice',
  share_video: 'Share Video',
  mute_move_members: 'Mute/Move Members',
}

function ServerView({ server, onBack, setActiveConversation, onOpenBilling, onStartCallWithUser, onMessageUser, openSettingsSection, onSectionOpened, jumpTarget, onJumpConsumed, onOpenUserSettings }) {
  // Subscribe to unread-state changes so channel ping dots re-render.
  useUnread()
  const [showServerDropdown, setShowServerDropdown] = useState(false)
  const [sidebarContextMenu, setSidebarContextMenu] = useState(null) // { x, y } or null
  const [showServerSettingsPage, setShowServerSettingsPage] = useState(false)
  const [settingsSection, setSettingsSection] = useState('profile')
  const [myServerProfile, setMyServerProfile] = useState(null)
  const [profileNickname, setProfileNickname] = useState('')
  const [profileAvatarFile, setProfileAvatarFile] = useState(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [permissionsChannel, setPermissionsChannel] = useState(null)
  const [permissionsCategory, setPermissionsCategory] = useState(null)
  const [canManageRoles, setCanManageRoles] = useState(false)
  const [canManageChannels, setCanManageChannels] = useState(false)
  const [canKickMembers, setCanKickMembers] = useState(false)
  const [canBanMembers, setCanBanMembers] = useState(false)
  const [canTimeoutMembers, setCanTimeoutMembers] = useState(false)
  const [canMuteMembers, setCanMuteMembers] = useState(false)
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
  // Set when arriving from a bookmark jump so ChannelView can scroll to and
  // flash the saved message.
  const [highlightMessageId, setHighlightMessageId] = useState(null)

  // Remember which channel the user was last viewing IN THIS SERVER, so
  // reopening the server jumps straight back to it instead of showing the
  // empty state every time. Keyed per-server since "last channel" only
  // makes sense within a specific server's own channel list.
  const handleOpenChannel = (channel) => {
    setActiveChannel(channel)
    setHighlightMessageId(null) // manual navigation cancels any pending jump highlight
    try {
      localStorage.setItem(`orbit_last_channel_${server.id}`, channel.id)
    } catch (err) {
      // localStorage unavailable (private browsing, etc.) — not worth
      // failing the actual channel switch over.
    }
  }
  const [members, setMembers] = useState([])
  const [myMembership, setMyMembership] = useState(null)
  const [myRoles, setMyRoles] = useState([])
  const [reportingId, setReportingId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportStatus, setReportStatus] = useState('')

  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState(null)

  const [ownerName, setOwnerName] = useState('')
  const [ownerStatus, setOwnerStatus] = useState('online')
  const [ownerLastSeen, setOwnerLastSeen] = useState(null)

  const [notificationSetting, setNotificationSetting] = useState('all')
  const [showOfflineMembersSetting, setShowOfflineMembersSetting] = useState(!!server.show_offline_members)

  // Owner-editable discovery tags (Batch 1). Kept separate from `server.tags`
  // so the picker can be edited/reset before saving.
  const [serverTags, setServerTags] = useState(() => sanitizeTags(server.tags))
  const [savedServerTags, setSavedServerTags] = useState(() => sanitizeTags(server.tags))
  const [tagsSaving, setTagsSaving] = useState(false)
  const [tagsSaved, setTagsSaved] = useState(false)
  const [tagsError, setTagsError] = useState('')
  const tagsDirty = JSON.stringify(serverTags) !== JSON.stringify(savedServerTags)

  const handleSaveServerTags = async () => {
    setTagsSaving(true)
    setTagsError('')
    setTagsSaved(false)
    try {
      // orbit_level is required-on-update and cannot be changed by clients,
      // so every partial server update has to echo it back unchanged.
      const fresh = await pb.collection('servers').getOne(server.id, { requestKey: null })
      await pb.collection('servers').update(server.id, {
        tags: serverTags,
        orbit_level: fresh.orbit_level,
      })
      setSavedServerTags(serverTags)
      setTagsSaved(true)
      setTimeout(() => setTagsSaved(false), 2000)
    } catch (err) {
      console.error('Save server tags error:', err)
      setTagsError('Could not save tags. Please try again.')
    } finally {
      setTagsSaving(false)
    }
  }

  const handleToggleShowOfflineMembers = async () => {
    const newValue = !showOfflineMembersSetting
    setShowOfflineMembersSetting(newValue) // instant feedback
    try {
      // orbit_level is required-on-update but can't be set to a NEW value
      // by clients (see pb_hooks/orbits.pb.js) — so any partial update to
      // this collection has to echo back its current value unchanged.
      // server.orbit_level (the prop) may be stale/undefined depending on
      // what ServerView was originally loaded with, so fetch fresh here
      // rather than trusting it.
      const fresh = await pb.collection('servers').getOne(server.id, { requestKey: null })
      await pb.collection('servers').update(server.id, {
        show_offline_members: newValue,
        orbit_level: fresh.orbit_level,
      })
    } catch (err) {
      console.error('Toggle show_offline_members error:', err)
      setShowOfflineMembersSetting(!newValue) // revert on failure
    }
  }

  const uid = pb.authStore.model.id
  const isOwner = server.owner === uid

  const [canManageInvites, setCanManageInvites] = useState(false)
  const [invites, setInvites] = useState([])
  const [showCreateInvite, setShowCreateInvite] = useState(false)
  const [inviteMaxUses, setInviteMaxUses] = useState('')
  const [inviteExpiry, setInviteExpiry] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteCreating, setInviteCreating] = useState(false)

  const loadInvites = async () => {
    if (!isOwner && !canManageInvites) return
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
        requestKey: null,
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
        requestKey: null,
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
      // Exclude the owner's own row — they can now lazily get one (see
      // RolesManager.jsx) purely so roles can be attached to them, but
      // they should never show up as a second, duplicate "member" entry
      // here or in MembersSidebar — the UI already renders them
      // separately as the owner everywhere.
      const records = await pb.collection('members').getFullList({
        filter: `server="${server.id}" && user != "${server.owner}"`,
        expand: 'user',
        requestKey: null,
      })
      setMembers(records)

      const mine = records.find((m) => m.user === uid)
      setMyMembership(mine || null)
      if (mine) {
        setNotificationSetting(mine.notification_setting || 'all')
        // My Roles panel data: roles this user holds in this server.
        try {
          const links = await pb.collection('member_roles').getFullList({
            filter: `member="${mine.id}"`,
            expand: 'role',
            requestKey: null,
          })
          const roleRecords = links
            .map((l) => l.expand?.role)
            .filter(Boolean)
            .sort((a, b) => (b.position || 0) - (a.position || 0))
          setMyRoles(roleRecords)
        } catch (roleErr) {
          console.error('Load my roles error:', roleErr)
          setMyRoles([])
        }
      } else {
        setMyRoles([])
      }
    } catch (err) {
      console.error(err)
    }
  }

  const loadOwnerName = async () => {
    try {
      const ownerRecord = await pb.collection('users').getOne(server.owner, { requestKey: null })
      setOwnerName(ownerRecord.name)
      setOwnerStatus(ownerRecord.status || 'online')
      setOwnerLastSeen(ownerRecord.last_seen || null)
      setOwnerAvatarUrl(ownerRecord.avatar ? pb.files.getURL(ownerRecord, ownerRecord.avatar, { thumb: '32x32' }) : null)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (activeChannel) return // already viewing something, don't override
    if (visibleChannels.length === 0) return

    try {
      const lastChannelId = localStorage.getItem(`orbit_last_channel_${server.id}`)
      if (lastChannelId) {
        const match = visibleChannels.find((c) => c.id === lastChannelId)
        if (match) {
          setActiveChannel(match)
        }
      }
    } catch (err) {
      // localStorage unavailable — just fall back to the empty state.
    }
  }, [visibleChannels])

  // Bookmark jump: once channels are known, open the target channel and pass
  // the message id down so ChannelView can scroll to it. If the channel was
  // deleted since the bookmark was saved, say so instead of silently doing
  // nothing.
  useEffect(() => {
    if (!jumpTarget) return
    if (visibleChannels.length === 0) return
    const match = visibleChannels.find((c) => c.id === jumpTarget.channelId)
    // Deferred so the state changes aren't synchronous within the effect body.
    const timer = setTimeout(() => {
      if (match) {
        setActiveChannel(match)
        setHighlightMessageId(jumpTarget.messageId || null)
      } else {
        setError('The channel this bookmark points to no longer exists.')
      }
      onJumpConsumed?.()
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, visibleChannels])

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
    hasPermission(uid, server, 'mute_move_members').then(setCanMuteMembers)
    hasPermission(uid, server, 'manage_invites').then(setCanManageInvites)

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
        setOwnerStatus(e.record.status || 'online')
        setOwnerLastSeen(e.record.last_seen || null)
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

  // Load the invite list when the Invites section is opened (previously it
  // was only refreshed after create/revoke, so the list was always empty on
  // first open).
  useEffect(() => {
    if (settingsSection === 'invites') {
      loadInvites()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsSection, canManageInvites])

  // Opening a server clears its rail-level ping dot. Individual unread
  // channels keep their own dots until opened.
  useEffect(() => {
    markRead('server', server.id)
  }, [server.id])

  // Opened from elsewhere (e.g. Settings → Boost this server): jump straight
  // to a specific server-settings section, then tell the caller it's consumed.
  useEffect(() => {
    if (openSettingsSection) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowServerSettingsPage(true)
      setSettingsSection(openSettingsSection)
      if (onSectionOpened) onSectionOpened()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSettingsSection])

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

  const handleDeleteServer = async () => {
    const confirmed = window.confirm(
      `Are you absolutely sure you want to delete "${server.name}"? This cannot be undone — all channels, messages, and members will be permanently removed.`
    )
    if (!confirmed) return

    try {
      await pb.collection('servers').delete(server.id)
      onBack()
    } catch (err) {
      console.error('Delete server error:', err)
      alert('Something went wrong deleting the server. Please try again.')
    }
  }

  const loadMyServerProfile = async () => {
    setProfileError('')
    try {
      const existing = await pb.collection('server_profiles').getFullList({
        filter: `server="${server.id}" && user="${pb.authStore.model.id}"`,
      })
      if (existing[0]) {
        setMyServerProfile(existing[0])
        setProfileNickname(existing[0].nickname || '')
      } else {
        setMyServerProfile(null)
        setProfileNickname('')
      }
    } catch (err) {
      console.error('Load server profile error:', err)
    }
  }

  const handleSaveServerProfile = async () => {
    setProfileSaving(true)
    setProfileError('')
    try {
      const formData = new FormData()
      formData.append('nickname', profileNickname)
      if (profileAvatarFile) {
        formData.append('avatar', profileAvatarFile)
      }

      if (myServerProfile) {
        const updated = await pb.collection('server_profiles').update(myServerProfile.id, formData)
        setMyServerProfile(updated)
      } else {
        formData.append('server', server.id)
        formData.append('user', pb.authStore.model.id)
        const created = await pb.collection('server_profiles').create(formData)
        setMyServerProfile(created)
      }
      setProfileAvatarFile(null)
    } catch (err) {
      console.error('Save server profile error:', err)
      setProfileError(err.message || 'Something went wrong saving your server profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleRemoveServerProfile = async () => {
    if (!myServerProfile) return
    setProfileSaving(true)
    try {
      await pb.collection('server_profiles').delete(myServerProfile.id)
      setMyServerProfile(null)
      setProfileNickname('')
    } catch (err) {
      console.error('Remove server profile error:', err)
    } finally {
      setProfileSaving(false)
    }
  }

  useEffect(() => {
    if (showServerSettingsPage && settingsSection === 'profile') {
      const tier = pb.authStore.model?.subscription_tier
      if (tier === 'plus' || tier === 'premium') {
        loadMyServerProfile()
      }
    }
  }, [showServerSettingsPage, settingsSection])

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

  const moderateVoice = async (member, changes) => {
    try {
      const response = await fetch(`${TOKEN_SERVER_URL}/voice/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: pb.authStore.token,
          serverId: server.id,
          targetUserId: member.user,
          ...changes,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Could not update voice state')
      }
      setMembers((prev) =>
        prev.map((m) =>
          m.id === member.id
            ? { ...m, voice_muted: data.voice_muted, voice_deafened: data.voice_deafened }
            : m
        )
      )
    } catch (err) {
      console.error('Voice moderation error:', err)
    }
  }

  const handleToggleServerMute = (member) => moderateVoice(member, { muted: !member.voice_muted })
  const handleToggleServerDeafen = (member) => moderateVoice(member, { deafened: !member.voice_deafened })

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

  let mainContent
  if (activeChannel && activeChannel.type === 'voice') {
    mainContent = (
      <VoiceChannel
        channel={activeChannel}
        server={server}
        canMuteMembers={isOwner || canMuteMembers}
        onBack={() => setActiveChannel(null)}
        members={members}
        ownerName={ownerName}
        ownerStatus={ownerStatus}
        ownerAvatarUrl={ownerAvatarUrl}
        ownerLastSeen={ownerLastSeen}
        ownerId={server.owner}
        showOfflineMembers={showOfflineMembersSetting}
        onStartCallWithUser={onStartCallWithUser}
        onMessageUser={onMessageUser}
      />
    )
  } else if (activeChannel) {
    mainContent = (
      <ChannelView
        channel={activeChannel}
        server={server}
        onBack={() => setActiveChannel(null)}
        setActiveConversation={setActiveConversation}
        members={members}
        ownerName={ownerName}
        ownerStatus={ownerStatus}
        ownerAvatarUrl={ownerAvatarUrl}
        ownerLastSeen={ownerLastSeen}
        showOfflineMembers={showOfflineMembersSetting}
        onStartCallWithUser={onStartCallWithUser}
        onMessageUser={onMessageUser}
        highlightMessageId={highlightMessageId}
        onHighlightConsumed={() => setHighlightMessageId(null)}
      />
    )
  } else if (showServerSettingsPage) {
    const settingsGroups = [
      {
        label: 'Overview',
        items: [
          { key: 'profile', label: 'Server Profile' },
          { key: 'engagement', label: 'Engagement' },
          { key: 'boosts', label: 'Boost Perks' },
        ],
      },
      {
        label: 'People',
        items: [
          { key: 'my-roles', label: 'My Roles' },
          { key: 'members', label: 'Members' },
          { key: 'roles', label: 'Roles' },
          ...((isOwner || canManageInvites) ? [{ key: 'invites', label: 'Invites' }] : []),
        ],
      },
      ...(isOwner ? [{
        label: 'Moderation',
        items: [
          { key: 'moderation', label: 'Bans' },
        ],
      }] : []),
    ]

    const myTier = pb.authStore.model?.subscription_tier
    const hasServerProfilePlan = myTier === 'plus' || myTier === 'premium'

    mainContent = (
      <div className="server-settings-page">
        <div className="server-settings-nav">
          <div className="server-settings-nav-title">{server.name}</div>

          {settingsGroups.map((group) => (
            <div key={group.label} className="server-settings-nav-group">
              <div className="server-settings-nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  className={`server-settings-nav-item${settingsSection === item.key ? ' active' : ''}`}
                  onClick={() => setSettingsSection(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}

          <div className="server-dropdown-divider" />
          <button className="server-settings-nav-item" onClick={() => setShowServerSettingsPage(false)}>
            ← Back to {server.name}
          </button>

          {isOwner && (
            <button className="server-settings-nav-item server-dropdown-danger" onClick={handleDeleteServer}>
              Delete Server
            </button>
          )}
        </div>

        <div className="server-settings-content">
          {settingsSection === 'profile' && (
            <div>
              <h2>Server Profile</h2>
              <p style={{ color: 'var(--text)' }}>Type: {server.type}</p>

              {!isOwner && myMembership && (
                <div style={{ margin: '16px 0' }}>
                  <label>Notifications: </label>
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
                <div style={{ margin: '16px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={showOfflineMembersSetting}
                      onChange={handleToggleShowOfflineMembers}
                    />
                    Show offline members to everyone
                  </label>
                </div>
              )}

              {isOwner && (
                <div className="server-tag-editor">
                  <h3>Server Tags</h3>
                  <p className="server-tag-editor-hint">
                    Shown on Discovery and used when members search their own server list.
                  </p>
                  <TagPicker value={serverTags} onChange={setServerTags} idPrefix="server-tags" />
                  <div className="server-tag-editor-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleSaveServerTags}
                      disabled={!tagsDirty || tagsSaving}
                    >
                      {tagsSaving ? 'Saving...' : 'Save tags'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setServerTags(savedServerTags)}
                      disabled={!tagsDirty || tagsSaving}
                    >
                      Reset
                    </button>
                    {tagsDirty && !tagsSaving && <span className="server-tag-editor-dirty">Unsaved changes</span>}
                    {tagsSaved && <span className="server-tag-editor-saved">Saved</span>}
                  </div>
                  {tagsError && <p style={{ color: 'var(--danger)' }}>{tagsError}</p>}
                </div>
              )}

              <hr />

              <h3>Your Nickname & Avatar Here</h3>
              {hasServerProfilePlan ? (
                <>
                  {profileError && <p style={{ color: 'var(--danger)' }}>{profileError}</p>}

                  {myServerProfile?.avatar && (
                    <img
                      src={pb.files.getURL(myServerProfile, myServerProfile.avatar, { thumb: '80x80' })}
                      alt=""
                      style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', display: 'block', marginBottom: '10px' }}
                    />
                  )}

                  <div style={{ marginBottom: '10px' }}>
                    <label>Nickname for this server: </label>
                    <input
                      type="text"
                      value={profileNickname}
                      onChange={(e) => setProfileNickname(e.target.value)}
                      placeholder={pb.authStore.model.name}
                    />
                  </div>

                  <div style={{ marginBottom: '10px' }}>
                    <label>Server avatar: </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setProfileAvatarFile(e.target.files[0] || null)}
                    />
                  </div>

                  <button className="btn-primary" onClick={handleSaveServerProfile} disabled={profileSaving}>
                    {profileSaving ? 'Saving...' : 'Save'}
                  </button>
                  {myServerProfile && (
                    <button onClick={handleRemoveServerProfile} disabled={profileSaving} style={{ marginLeft: '10px' }}>
                      Remove server profile
                    </button>
                  )}
                </>
              ) : (
                <p style={{ color: 'var(--text)' }}>A custom per-server nickname/avatar is an Orbit+/Premium perk.</p>
              )}
            </div>
          )}

          {settingsSection === 'engagement' && (
            <div className="centered-placeholder">
              <h2>Coming Soon</h2>
            </div>
          )}

          {settingsSection === 'boosts' && (
            <OrbitsBoost server={server} onClose={() => setSettingsSection('profile')} onOpenBilling={onOpenBilling} />
          )}

          {settingsSection === 'my-roles' && (
            <div>
              <h2>My Roles</h2>
              <p style={{ color: 'var(--text)' }}>
                Roles you hold in {server.name}. Higher roles outrank lower ones.
              </p>

              {isOwner ? (
                <p>👑 You own this server, so you have every permission regardless of roles.</p>
              ) : myRoles.length === 0 ? (
                <p style={{ color: 'var(--text)' }}>You don't have any roles in this server yet.</p>
              ) : (
                <ul className="list-reset">
                  {myRoles.map((role) => (
                    <li key={role.id} className="list-row">
                      <span
                        className="server-profile-popup-role-pill"
                        style={role.colour ? { borderColor: role.colour, color: role.colour } : undefined}
                      >
                        {role.name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: '20px' }}>What these roles grant</h3>
              {isOwner ? (
                <p style={{ color: 'var(--text)' }}>All permissions (owner).</p>
              ) : (
                <ul className="list-reset">
                  {(() => {
                    const granted = Object.keys(ROLE_PERMISSION_LABELS).filter((key) =>
                      myRoles.some((role) => role[key] === true)
                    )
                    if (granted.length === 0) {
                      return <li style={{ color: 'var(--text)' }}>No server-wide permissions.</li>
                    }
                    return granted.map((key) => <li key={key}>✅ {ROLE_PERMISSION_LABELS[key]}</li>)
                  })()}
                </ul>
              )}
              <p style={{ color: 'var(--text)', fontSize: '0.85em', marginTop: '12px' }}>
                Per-channel overrides can grant or deny permissions on top of these roles.
              </p>
            </div>
          )}

          {settingsSection === 'members' && (
            <div>
              <h2>Members</h2>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  {ownerAvatarUrl ? (
                    <img src={ownerAvatarUrl} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--surface-2)' }} />
                  )}
                  <strong>{ownerName || 'Unknown'}</strong> ({getEffectiveStatus({ status: ownerStatus, last_seen: ownerLastSeen })}) — Owner
                </li>
                {members.map((member) => (
                  <li key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {member.expand?.user?.avatar ? (
                      <img src={pb.files.getURL(member.expand.user, member.expand.user.avatar, { thumb: '32x32' })} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--surface-2)' }} />
                    )}
                    {member.expand?.user?.name || 'Unknown'} ({member.expand?.user?.status === 'invisible' ? 'offline' : (member.expand?.user?.status || 'online')})
                    {(isOwner || canKickMembers) && (
                      <button onClick={() => handleKick(member.id)} style={{ color: 'var(--warning)' }}>Kick</button>
                    )}
                    {(isOwner || canBanMembers) && (
                      <button onClick={() => handleBan(member)} className="btn-danger">Ban</button>
                    )}
                    {(isOwner || canTimeoutMembers) && (
                      <button onClick={() => handleTimeout(member.id)} style={{ color: 'var(--warning)' }}>Timeout (10m)</button>
                    )}
                    {(isOwner || canMuteMembers) && member.user !== server.owner && (
                      <>
                        <button
                          onClick={() => handleToggleServerMute(member)}
                          style={{ color: member.voice_muted ? 'var(--teal)' : 'var(--warning)' }}
                        >
                          {member.voice_muted ? 'Server Unmute' : 'Server Mute'}
                        </button>
                        <button
                          onClick={() => handleToggleServerDeafen(member)}
                          style={{ color: member.voice_deafened ? 'var(--teal)' : 'var(--warning)' }}
                        >
                          {member.voice_deafened ? 'Server Undeafen' : 'Server Deafen'}
                        </button>
                      </>
                    )}
                    <button onClick={() => setReportingId(reportingId === member.id ? null : member.id)}>Report</button>

                    {reportingId === member.id && (
                      <div style={{ width: '100%' }}>
                        <input
                          type="text"
                          placeholder="Reason for report"
                          value={reportReason}
                          onChange={(e) => setReportReason(e.target.value)}
                        />
                        <button onClick={() => handleSubmitReport('user', member.user)}>Submit Report</button>
                        {reportStatus && <p>{reportStatus}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {settingsSection === 'roles' && (
            (isOwner || canManageRoles) ? (
              <RolesManager server={server} onClose={() => setSettingsSection('profile')} />
            ) : (
              <div>
                <h2>Roles</h2>
                <p style={{ color: 'var(--text)' }}>You don't have permission to manage roles in this server.</p>
              </div>
            )
          )}

          {settingsSection === 'invites' && (isOwner || canManageInvites) && (
            <div>
              <h2>Invites</h2>

              {!showCreateInvite && (
                <button className="btn-primary" onClick={() => setShowCreateInvite(true)}>Create Invite</button>
              )}

              {showCreateInvite && (
                <div style={{ marginTop: '10px' }}>
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
                  <button className="btn-primary" onClick={handleCreateInvite} disabled={inviteCreating}>
                    {inviteCreating ? 'Creating...' : 'Generate Invite'}
                  </button>
                  <button onClick={() => setShowCreateInvite(false)}>Cancel</button>
                  {inviteError && <p style={{ color: 'var(--danger)' }}>{inviteError}</p>}
                </div>
              )}

              <ul style={{ marginTop: '16px' }}>
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

          {settingsSection === 'moderation' && isOwner && (
            <div className="centered-placeholder">
              <h2>Coming Soon</h2>
            </div>
          )}
        </div>
      </div>
    )
  } else if (permissionsChannel) {
    mainContent = (
      <ChannelPermissions
        channel={permissionsChannel}
        server={server}
        onClose={() => {
          setPermissionsChannel(null)
          loadChannels()
        }}
      />
    )
  } else if (permissionsCategory) {
    mainContent = (
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
  } else {
    mainContent = (
      <div className="channel-empty-state">
        <p>👈 Select a channel to start chatting, or manage your server using the sidebar.</p>
      </div>
    )
  }

  const uncategorized = visibleChannels.filter((c) => !c.category)

  const renderChannel = (channel) => {
    const unread = channel.type !== 'voice' ? getChannelUnread(channel.id) : null
    return (
    <li key={channel.id} className="channel-item-row">
      <button
        className={`channel-item${activeChannel?.id === channel.id ? ' active' : ''}${unread ? ' channel-item-unread' : ''}`}
        onClick={() => handleOpenChannel(channel)}
      >
        <span className="channel-item-icon">{channel.type === 'voice' ? '🔊' : '#'}</span>
        {channel.name}
        {unread && (
          unread.mention
            ? <span className="channel-unread-mention" title="You were mentioned">@</span>
            : <span className="channel-unread-dot" title="Unread" />
        )}
      </button>
      {(isOwner || canManageChannels || channelManageAccess[channel.id]) && (
        <button className="channel-item-settings" onClick={() => setPermissionsChannel(channel)} title="Channel Settings">⚙</button>
      )}
    </li>
    )
  }

  return (
    <div className="server-view-shell">
      <div className="channel-sidebar">
        <div className="channel-sidebar-header" style={{ position: 'relative' }}>
          <button
            className="server-dropdown-trigger"
            onClick={() => setShowServerDropdown((v) => !v)}
          >
            <h2>{server.name}</h2>
            <span>{showServerDropdown ? '▲' : '▼'}</span>
          </button>

          {showServerDropdown && (
            <div className="server-dropdown-menu" onMouseLeave={() => setShowServerDropdown(false)}>
              <button onClick={() => { setActiveChannel(null); setShowServerSettingsPage(true); setSettingsSection('boosts'); setShowServerDropdown(false) }}>
                <span>⭐ Server Boost</span>
              </button>
              {isOwner && (
                <button onClick={() => { setActiveChannel(null); setShowServerSettingsPage(true); setSettingsSection('invites'); setShowServerDropdown(false) }}>
                  <span>✉️ Invite to Server</span>
                </button>
              )}
              <button onClick={() => { setActiveChannel(null); setShowServerSettingsPage(true); setSettingsSection('profile'); setShowServerDropdown(false) }}>
                <span>⚙️ Server Settings</span>
              </button>
              <div className="server-dropdown-divider" />
              {(isOwner || canManageChannels) && (
                <>
                  <button
                    onClick={() => { setChannelCategoryId(''); setShowCreateChannelModal(true); setShowServerDropdown(false) }}
                  >
                    <span>➕ Create Channel</span>
                  </button>
                  <button onClick={() => { setShowCreateCategory(true); setShowServerDropdown(false) }}>
                    <span>🗂️ Create Category</span>
                  </button>
                  <div className="server-dropdown-divider" />
                </>
              )}
              <button
                className="server-dropdown-danger"
                onClick={() => { setReportingId(reportingId === 'server' ? null : 'server'); setShowServerDropdown(false) }}
              >
                <span>🚩 Report Server</span>
              </button>
            </div>
          )}

          {reportingId === 'server' && (
            <div className="server-report-inline">
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
        </div>

        <div
          className="channel-sidebar-list"
          onContextMenu={(e) => {
            if (!isOwner && !canManageChannels) return
            e.preventDefault()
            setSidebarContextMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          {successMessage && <p style={{ color: 'var(--teal)', padding: '0 8px' }}>{successMessage}</p>}
          {categoryError && <p style={{ color: 'var(--danger)', padding: '0 8px' }}>{categoryError}</p>}

          {uncategorized.length > 0 && (
            <ul className="channel-list">
              {uncategorized.map(renderChannel)}
            </ul>
          )}

          {categories.map((category) => {
            const categoryChannels = visibleChannels.filter((c) => c.category === category.id)
            const isCollapsed = collapsedCategories.has(category.id)

            return (
              <div key={category.id} className="channel-category">
                <div className="channel-category-header">
                  <span
                    onClick={() => toggleCategoryCollapsed(category.id)}
                    className="channel-category-title"
                  >
                    {isCollapsed ? '▶' : '▼'} {category.name.toUpperCase()}
                  </span>

                  {(isOwner || canManageChannels || categoryManageAccess[category.id]) && (
                    <span className="channel-category-actions">
                      <button
                        onClick={() => {
                          setChannelCategoryId(category.id)
                          setShowCreateChannelModal(true)
                        }}
                        title="Add Channel"
                      >
                        +
                      </button>
                      <button onClick={() => setPermissionsCategory(category)} title="Category Settings">⚙</button>
                    </span>
                  )}
                </div>

                {!isCollapsed && (
                  <ul className="channel-list">
                    {categoryChannels.map(renderChannel)}
                    {categoryChannels.length === 0 && (
                      <li className="channel-empty-note">No channels in this category.</li>
                    )}
                  </ul>
                )}
              </div>
            )
          })}

          {visibleChannels.length === 0 && <p style={{ padding: '0 8px', color: 'var(--text)' }}>No channels yet.</p>}

          {showCreateCategory && (
            <div className="channel-sidebar-add">
              <input
                type="text"
                placeholder="New Category"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                autoFocus
              />
              <button className="btn-primary" onClick={handleCreateCategory}>Save</button>
              <button onClick={() => { setShowCreateCategory(false); setCategoryName(''); setCategoryError('') }}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <UserPanel onOpenSettings={onOpenUserSettings} />

        {sidebarContextMenu && (
          <div
            className="sidebar-context-menu-overlay"
            onClick={() => setSidebarContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setSidebarContextMenu(null) }}
          >
            <div
              className="sidebar-context-menu"
              style={{ top: sidebarContextMenu.y, left: sidebarContextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setChannelCategoryId('')
                  setShowCreateChannelModal(true)
                  setSidebarContextMenu(null)
                }}
              >
                Create Channel
              </button>
              <button
                onClick={() => {
                  setShowCreateCategory(true)
                  setSidebarContextMenu(null)
                }}
              >
                Create Category
              </button>
              <div className="server-dropdown-divider" />
              {isOwner && (
                <button
                  onClick={() => {
                    setActiveChannel(null)
                    setShowServerSettingsPage(true)
                    setSettingsSection('invites')
                    setSidebarContextMenu(null)
                  }}
                >
                  Invite to Server
                </button>
              )}
            </div>
          </div>
        )}

        {showCreateChannelModal && (
          <div
            onClick={() => setShowCreateChannelModal(false)}
            className="modal-overlay"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="modal-panel"
            >
              <h2 style={{ marginTop: 0 }}>Create Channel</h2>
              {channelCategoryId && (
                <p style={{ color: 'var(--text)', marginTop: '-8px' }}>
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

                {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" onClick={() => setShowCreateChannelModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? 'Creating...' : 'Create Channel'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>

      <div className="server-main">
        {mainContent}
      </div>
    </div>
  )
}

export default ServerView