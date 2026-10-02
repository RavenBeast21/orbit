import { useState, useEffect, useRef, useCallback } from 'react'
import pb from '../pocketbase'
import { hasChannelPermission, hasPermission } from '../permissions'
import MembersSidebar from './MembersSidebar'
import EmojiPicker, { renderMessageContent } from './EmojiPicker'
import UserContextMenu from './UserContextMenu'
import ServerProfilePopup from './ServerProfilePopup'
import FullProfileModal from './FullProfileModal'
import InviteToServerModal from './InviteToServerModal'
import { SpamFilteredText, BurstGuard } from './SpamFilteredText'
import { maybeConvertEmoticons } from '../textUtils'
import { markRead } from '../unread'
import { toggleBookmark, loadBookmarkedMessageIds } from '../bookmarks'
import { useReactions } from '../reactions'
import ReactionBar from './ReactionBar'
import EmojiAutocomplete from './EmojiAutocomplete'
import QuickReactions from './QuickReactions'
import ConfirmDialog from './ConfirmDialog'
import PinnedMessages from './PinnedMessages'

function ChannelView({ channel, server, onBack, setActiveConversation, members, ownerName, ownerStatus, ownerAvatarUrl, ownerLastSeen, showOfflineMembers, onStartCallWithUser, onMessageUser, highlightMessageId, onHighlightConsumed }) {
  const [messages, setMessages] = useState([])
  const messageListRef = useRef(null)
  const stickToBottomRef = useRef(true)

  const handleMessageListScroll = () => {
    const el = messageListRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  const [content, setContent] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emojiAutocompleteQuery, setEmojiAutocompleteQuery] = useState(null)
  const composerInputRef = useRef(null)
  const autocompleteFirstRef = useRef(null)
  const [emojiCache, setEmojiCache] = useState({}) // id -> emoji record, for rendering sent messages
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [reportingId, setReportingId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  // Pinned messages: topbar panel + moderator pin/unpin. Permission is
  // enforced server-side in pb_hooks/messages_moderation.pb.js.
  const [pinnedMessages, setPinnedMessages] = useState([])
  const [pinnedLoaded, setPinnedLoaded] = useState(false)
  const [canManageMessages, setCanManageMessages] = useState(false)

  const [attachmentFile, setAttachmentFile] = useState(null)
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState(null)
  const [attachmentError, setAttachmentError] = useState('')
  const attachmentInputRef = useRef(null)
  const emojiBtnRef = useRef(null)
  const [emojiAnchor, setEmojiAnchor] = useState(null)

  // Click / right-click profile state, shared across message avatars and
  // MembersSidebar (mention/call/message actions bubble up from either).
  const [contextMenu, setContextMenu] = useState(null) // { x, y, userId, isSelf }
  const [serverPopup, setServerPopup] = useState(null) // { x, y, userId }
  const [fullProfileUserId, setFullProfileUserId] = useState(null)
  const [inviteTargetUserId, setInviteTargetUserId] = useState(null)
  const [blockedUserIds, setBlockedUserIds] = useState(new Set())
  const [friendUserIds, setFriendUserIds] = useState(new Set())
  const myUid = pb.authStore.model.id

  // Message reactions for this channel (server messages).
  const { byTarget: reactionsByTarget, toggle: toggleReaction } = useReactions({
    scopeField: 'channel',
    scopeId: channel?.id,
  })

  // Shift held + hovered message → favourite quick-reactions on the right.
  const [shiftHeld, setShiftHeld] = useState(false)
  const [hoveredMessageId, setHoveredMessageId] = useState(null)
  useEffect(() => {
    const down = (e) => { if (e.key === 'Shift') setShiftHeld(true) }
    const up = (e) => { if (e.key === 'Shift') setShiftHeld(false) }
    const blur = () => setShiftHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Message character limit by the SENDER's own subscription tier — the
  // real enforcement happens server-side in pb_hooks/message_limits.pb.js,
  // this is just for the live counter / preventing an obviously-doomed send.
  const myTier = pb.authStore.model?.subscription_tier
  const charLimit = myTier === 'premium' ? 4000 : myTier === 'plus' ? 3000 : 2000
  const charsRemaining = charLimit - content.length

  const loadMessages = async () => {
    try {
      const records = await pb.collection('messages').getFullList({
        filter: `channel="${channel.id}"`,
        sort: 'created',
        expand: 'sender',
        requestKey: null,
      })
      setMessages(records)
    } catch (err) {
      console.error(err)
    }
  }

  // Opening a channel always jumps to the newest message; while the user is
  // already at the bottom, new messages keep it pinned there. When arriving
  // from a bookmark jump, we scroll to the target message instead.
  useEffect(() => {
    stickToBottomRef.current = !highlightMessageId
  }, [channel.id, highlightMessageId])

  useEffect(() => {
    const el = messageListRef.current
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  // Bookmark jump: scroll to and briefly flash the target message once the
  // channel's messages are loaded. This channel loads its full history, so the
  // target is always present.
  const [flashMessageId, setFlashMessageId] = useState(null)
  useEffect(() => {
    if (!highlightMessageId) return
    if (!messages.some((m) => m.id === highlightMessageId)) return
    stickToBottomRef.current = false
    const el = document.getElementById(`msg-${highlightMessageId}`)
    if (el) el.scrollIntoView({ block: 'center' })
    const show = setTimeout(() => {
      setFlashMessageId(highlightMessageId)
      onHighlightConsumed?.()
    }, 0)
    return () => clearTimeout(show)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, highlightMessageId])

  // Clear the flash on its own timer. This must NOT live in the effect above,
  // because that effect's cleanup runs when the jump prop is consumed or the
  // message list changes — which would cancel the clear timer and leave the
  // highlight bar stuck on screen.
  useEffect(() => {
    if (!flashMessageId) return
    const timer = setTimeout(() => setFlashMessageId(null), 3000)
    return () => clearTimeout(timer)
  }, [flashMessageId])

  // Jump from the pinned-messages panel: scroll the target into view and
  // re-trigger the flash even if it is already the flashing message.
  const jumpToMessage = (id) => {
    stickToBottomRef.current = false
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashMessageId(null)
    requestAnimationFrame(() => setFlashMessageId(id))
  }

  const handleUnpinById = (id) => {
    const msg = pinnedMessages.find((m) => m.id === id)
    if (msg) return handleTogglePin(msg)
    return Promise.resolve()
  }

  const loadPinned = async () => {
    try {
      const records = await pb.collection('messages').getFullList({
        filter: `channel="${channel.id}" && pinned=true`,
        sort: '-created',
        expand: 'sender',
        requestKey: null,
      })
      setPinnedMessages(records)
    } catch (err) {
      console.error('Load pinned messages error:', err)
    } finally {
      setPinnedLoaded(true)
    }
  }

  // Personal bookmarks (report §4.23) — independent of server pin permission.
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set())

  useEffect(() => {
    if (!myUid) return
    let cancelled = false
    loadBookmarkedMessageIds(myUid, { channelId: channel.id }).then((ids) => {
      if (!cancelled) setBookmarkedIds(ids)
    })
    return () => { cancelled = true }
  }, [channel.id, myUid])

  const handleToggleBookmark = async (msg) => {
    const willAdd = !bookmarkedIds.has(msg.id)
    setBookmarkedIds((prev) => {
      const next = new Set(prev)
      if (willAdd) next.add(msg.id)
      else next.delete(msg.id)
      return next
    })
    try {
      await toggleBookmark({
        userId: myUid,
        messageId: msg.id,
        channelId: channel.id,
        content: msg.content || '',
        authorName: msg.expand?.sender?.name || '',
        sourceLabel: server?.name ? `${server.name} · #${channel.name}` : `#${channel.name}`,
      })
    } catch (err) {
      console.error('Toggle bookmark error:', err)
      setBookmarkedIds((prev) => {
        const next = new Set(prev)
        if (willAdd) next.delete(msg.id)
        else next.add(msg.id)
        return next
      })
    }
  }

  const handleTogglePin = async (msg) => {
    try {
      await pb.collection('messages').update(msg.id, { pinned: !msg.pinned })
    } catch (err) {
      console.error('Pin message error:', err)
    }
  }

  const performMessageDelete = async (msg) => {
    setDeleteTarget(null)
    try {
      await pb.collection('messages').delete(msg.id)
      setMessages((prev) => prev.filter((m) => m.id !== msg.id))
    } catch (err) {
      console.error('Delete message error:', err)
      setError('Could not delete that message')
    }
  }

  useEffect(() => {
    if (setActiveConversation) {
      setActiveConversation({ type: 'channel', id: channel.id })
    }
    return () => {
      if (setActiveConversation) setActiveConversation(null)
    }
  }, [channel.id])

  useEffect(() => {
    loadMessages()
    loadPinned()
    markRead('channel', channel.id)

    if (server) {
      hasPermission(myUid, server, 'manage_messages').then(setCanManageMessages)
    }

    let unsub

    pb.collection('messages').subscribe('*', async (e) => {
      if (e.record.channel !== channel.id) return

      if (e.action === 'create') {
        const fullRecord = await pb.collection('messages').getOne(e.record.id, {
          expand: 'sender',
        })
        setMessages((prev) => [...prev, fullRecord])
      } else if (e.action === 'update') {
        // Pinned state lives on the message record; refresh the bar and the
        // inline content when a message is edited/pinned.
        loadPinned()
        setMessages((prev) =>
          prev.map((m) => (m.id === e.record.id ? { ...m, content: e.record.content, pinned: e.record.pinned } : m))
        )
      } else if (e.action === 'delete') {
        loadPinned()
        setMessages((prev) => prev.filter((m) => m.id !== e.record.id))
      }
    }).then((fn) => {
      unsub = fn
    })

    return () => {
      if (unsub) unsub()
    }
  }, [channel.id])

  useEffect(() => {
    // Whenever messages change, resolve any :name:id: tokens we haven't
    // already fetched, so renderMessageContent can show the real images.
    const tokenPattern = /:[^:\s]+:([a-zA-Z0-9]{15}):/g
    const idsNeeded = new Set()
    messages.forEach((msg) => {
      let match
      while ((match = tokenPattern.exec(msg.content || '')) !== null) {
        if (!emojiCache[match[1]]) idsNeeded.add(match[1])
      }
    })

    if (idsNeeded.size === 0) return

    const loadMissing = async () => {
      const updates = {}
      for (const id of idsNeeded) {
        try {
          updates[id] = await pb.collection('emojis').getOne(id)
        } catch (err) {
          // Deleted/invalid emoji id — renderMessageContent already
          // handles a cache miss gracefully by showing the raw token.
        }
      }
      if (Object.keys(updates).length > 0) {
        setEmojiCache((prev) => ({ ...prev, ...updates }))
      }
    }
    loadMissing()
  }, [messages])

  // My own blocked list + friends list, so the context menu can show the
  // right label without a fresh query on every right-click.
  useEffect(() => {
    const loadRelations = async () => {
      try {
        const blocked = await pb.collection('blocked_users').getFullList({
          filter: `blocker="${myUid}"`,
          requestKey: null,
        })
        setBlockedUserIds(new Set(blocked.map((b) => b.blocked)))
      } catch (err) {
        console.error('Load blocked users error:', err)
      }

      try {
        const friendsA = await pb.collection('friends').getFullList({
          filter: `user_a="${myUid}"`,
          requestKey: null,
        })
        const friendsB = await pb.collection('friends').getFullList({
          filter: `user_b="${myUid}"`,
          requestKey: null,
        })
        setFriendUserIds(new Set([
          ...friendsA.map((f) => f.user_b),
          ...friendsB.map((f) => f.user_a),
        ]))
      } catch (err) {
        console.error('Load friends error:', err)
      }
    }
    loadRelations()
  }, [myUid])

  const handleContentChange = (e) => {
    const newValue = e.target.value
    setContent(newValue)

    // Inline ":" autocomplete: if the text before the cursor ends in an
    // unterminated ":query", show the inline autocomplete list (standard
    // emojis first, then custom server emojis) — NOT the full picker.
    const cursorPos = e.target.selectionStart
    const beforeCursor = newValue.slice(0, cursorPos)
    const inlineMatch = beforeCursor.match(/:([a-zA-Z0-9_]{1,30})$/)
    setEmojiAutocompleteQuery(inlineMatch ? inlineMatch[1] : null)
  }

  const handleAutocompleteSelect = (value) => {
    const input = composerInputRef.current
    const cursorPos = input?.selectionStart ?? content.length
    const beforeCursor = content.slice(0, cursorPos)
    const afterCursor = content.slice(cursorPos)
    const replaced = beforeCursor.replace(/:([a-zA-Z0-9_]{1,30})$/, value)
    setContent(replaced + afterCursor)
    setEmojiAutocompleteQuery(null)
    requestAnimationFrame(() => input?.focus())
  }

  const handleAutocompleteFirst = useCallback((value) => {
    autocompleteFirstRef.current = value
  }, [])

  const handleEmojiSelect = (value) => {
    setContent((prev) => prev + value)
    setShowEmojiPicker(false)
  }

  // Mention: inserts "@Name " into the composer. Looks up the user's
  // display name (falls back to id if lookup fails) so the inserted text
  // reads naturally — this is a plain text insert, not a rich mention
  // token, matching how the rest of the composer already works.
  const handleInsertMention = async (userId) => {
    try {
      const user = await pb.collection('users').getOne(userId)
      const mentionText = `@${user.name || user.username} `
      setContent((prev) => (prev ? `${prev.trimEnd()} ${mentionText}` : mentionText))
    } catch (err) {
      console.error('Insert mention error:', err)
    }
  }

  const handleAddFriend = async (targetUserId) => {
    try {
      const existing = await pb.collection('friend_requests').getFullList({
        filter: `(from_user="${myUid}" && to_user="${targetUserId}") || (from_user="${targetUserId}" && to_user="${myUid}")`,
      })
      if (existing.some((r) => r.status === 'pending')) return
      await pb.collection('friend_requests').create({
        from_user: myUid,
        to_user: targetUserId,
        status: 'pending',
        context_server: server?.id || undefined,
      })
    } catch (err) {
      console.error('Add friend error:', err)
    }
  }

  const handleToggleBlock = async (targetUserId) => {
    try {
      if (blockedUserIds.has(targetUserId)) {
        const existing = await pb.collection('blocked_users').getFullList({
          filter: `blocker="${myUid}" && blocked="${targetUserId}"`,
        })
        if (existing[0]) await pb.collection('blocked_users').delete(existing[0].id)
        setBlockedUserIds((prev) => {
          const next = new Set(prev)
          next.delete(targetUserId)
          return next
        })
      } else {
        await pb.collection('blocked_users').create({ blocker: myUid, blocked: targetUserId })
        setBlockedUserIds((prev) => new Set(prev).add(targetUserId))
      }
    } catch (err) {
      console.error('Toggle block error:', err)
    }
  }

  const handleReportUserProfile = async (targetUserId) => {
    try {
      await pb.collection('reports').create({
        reported_by: myUid,
        target_type: 'user_profile',
        target_id: targetUserId,
        reason: 'Reported from profile',
        status: 'pending',
      })
    } catch (err) {
      console.error('Report user profile error:', err)
    }
  }

  const handleAttachmentPick = (e) => {
    setAttachmentError('')
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setAttachmentError('Only image files can be attached right now')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setAttachmentError('Image must be under 10MB')
      return
    }

    setAttachmentFile(file)
    setAttachmentPreviewUrl(URL.createObjectURL(file))
  }

  const handleRemoveAttachment = () => {
    setAttachmentFile(null)
    setAttachmentPreviewUrl(null)
    setAttachmentError('')
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
  }

  const handleSend = async (e) => {
    e.preventDefault()
    setError('')

    if (!content.trim() && !attachmentFile) {
      setError('Message cannot be empty')
      return
    }

    const uid = pb.authStore.model.id

    if (server) {
      const canSend = await hasChannelPermission(uid, server, channel, 'send_messages')
      if (!canSend) {
        setError('You do not have permission to send messages in this channel')
        return
      }
    }

    try {
      const myMemberships = await pb.collection('members').getFullList({
        filter: `user="${uid}" && server="${channel.server}"`,
      })
      const myMembership = myMemberships[0]

      if (myMembership?.timed_out_until && new Date(myMembership.timed_out_until) > new Date()) {
        setError(`You are timed out until ${new Date(myMembership.timed_out_until).toLocaleTimeString()}`)
        return
      }
    } catch (err) {
      console.error('Timeout check error:', err)
    }

    setSending(true)

    try {
      const formData = new FormData()
      // ASCII emoticons (:), :D, <3, ...) are converted on send when the user
      // has enabled the preference.
      formData.append('content', maybeConvertEmoticons(content, pb.authStore.model?.ascii_emoticons))
      formData.append('sender', pb.authStore.model.id)
      formData.append('channel', channel.id)
      if (attachmentFile) formData.append('attachment', attachmentFile)

      await pb.collection('messages').create(formData)

      setContent('')
      handleRemoveAttachment()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong sending the message')
    } finally {
      setSending(false)
    }
  }

  const handleSubmitReport = async (messageId) => {
    if (!reportReason.trim()) {
      setReportStatus('Please enter a reason')
      return
    }

    try {
      await pb.collection('reports').create({
        reported_by: pb.authStore.model.id,
        target_type: 'message',
        target_id: messageId,
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

  return (
    <div className="channel-view-shell">
      <div className="channel-main">
        <div className="channel-topbar">
          <span className="channel-topbar-icon">#</span>
          <h2>{channel.name}</h2>
          <div className="channel-topbar-actions">
            <PinnedMessages
              loading={!pinnedLoaded}
              items={pinnedMessages.map((pm) => ({
                id: pm.id,
                authorName: pm.expand?.sender?.name || 'Unknown',
                avatarUrl: pm.expand?.sender?.avatar
                  ? pb.files.getURL(pm.expand.sender, pm.expand.sender.avatar, { thumb: '32x32' })
                  : null,
                content: pm.content,
                created: pm.created,
              }))}
              onJump={jumpToMessage}
              onUnpin={canManageMessages ? handleUnpinById : undefined}
              emptyHint={canManageMessages
                ? 'Hover over a message and choose Pin to keep it here.'
                : 'Members with Manage Messages can pin messages in this channel.'}
            />
          </div>
        </div>

        <div className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
          {messages.length === 0 && <p className="message-list-empty">No messages yet — say hello!</p>}
          {messages.map((msg, index) => (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={`message-row${shiftHeld && hoveredMessageId === msg.id ? ' message-row-shift' : ''}${flashMessageId === msg.id ? ' message-row-highlight' : ''}`}
              style={{ fontSize: 'var(--orbit-text-size, 16px)' }}
              onMouseEnter={() => setHoveredMessageId(msg.id)}
              onMouseLeave={() => setHoveredMessageId((cur) => (cur === msg.id ? null : cur))}
            >
              {msg.expand?.sender?.avatar ? (
                <img
                  src={pb.files.getURL(msg.expand.sender, msg.expand.sender.avatar, { thumb: '32x32' })}
                  alt=""
                  className="message-avatar"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    if (!msg.expand?.sender?.id) return
                    setServerPopup({ x: e.clientX, y: e.clientY, userId: msg.expand.sender.id })
                  }}
                  onContextMenu={(e) => {
                    if (!msg.expand?.sender?.id) return
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, userId: msg.expand.sender.id, isSelf: msg.expand.sender.id === myUid })
                  }}
                />
              ) : (
                <div className="message-avatar message-avatar-fallback" />
              )}
              <div className="message-body">
                <div className="message-header">
                  <strong
                    className="message-sender"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      if (!msg.expand?.sender?.id) return
                      setServerPopup({ x: e.clientX, y: e.clientY, userId: msg.expand.sender.id })
                    }}
                    onContextMenu={(e) => {
                      if (!msg.expand?.sender?.id) return
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, userId: msg.expand.sender.id, isSelf: msg.expand.sender.id === myUid })
                    }}
                  >
                    {msg.expand?.sender?.name || 'Unknown'}
                  </strong>
                  <button className="message-report-btn" onClick={() => setReportingId(reportingId === msg.id ? null : msg.id)}>
                    Report
                  </button>
                  <button
                    className="message-report-btn"
                    title={bookmarkedIds.has(msg.id) ? 'Remove bookmark' : 'Bookmark message'}
                    onClick={() => handleToggleBookmark(msg)}
                    style={bookmarkedIds.has(msg.id) ? { color: 'var(--accent)' } : undefined}
                  >
                    {bookmarkedIds.has(msg.id) ? '🔖 Saved' : '🔖'}
                  </button>
                  {canManageMessages && (
                    <button className="message-report-btn" onClick={() => handleTogglePin(msg)}>
                      {msg.pinned ? 'Unpin' : 'Pin'}
                    </button>
                  )}
                  {(msg.sender === myUid || canManageMessages) && (
                    <button
                      className="message-delete-btn"
                      title="Delete message"
                      onClick={() => (shiftHeld ? performMessageDelete(msg) : setDeleteTarget(msg))}
                    >
                      🗑️
                    </button>
                  )}
                </div>
                <div className="message-content">
                  <BurstGuard messages={messages} index={index}>
                    <SpamFilteredText senderId={msg.expand?.sender?.id || msg.sender} text={msg.content}>
                      {renderMessageContent(msg.content, emojiCache)}
                    </SpamFilteredText>
                  </BurstGuard>
                </div>

                {msg.attachment && (
                  <img
                    src={pb.files.getURL(msg, msg.attachment, { thumb: '400x0' })}
                    alt="attachment"
                    className="message-attachment-image"
                    data-nsfw-scan-pending="true"
                  />
                )}

                <ReactionBar
                  targetId={msg.id}
                  reactions={reactionsByTarget[msg.id] || []}
                  currentUserId={myUid}
                  onToggle={toggleReaction}
                  emojiCache={emojiCache}
                />

                {reportingId === msg.id && (
                  <div className="message-report-form">
                    <input
                      type="text"
                      placeholder="Reason for report"
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                    />
                    <button onClick={() => handleSubmitReport(msg.id)}>Submit Report</button>
                    {reportStatus && <p>{reportStatus}</p>}
                  </div>
                )}
              </div>

              {shiftHeld && hoveredMessageId === msg.id && (
                <QuickReactions
                  onSelect={(emoji) => toggleReaction(msg.id, emoji, myUid)}
                  emojiCache={emojiCache}
                />
              )}
            </div>
          ))}
        </div>

        <div className="message-composer-area">
          {attachmentPreviewUrl && (
            <div className="message-composer-attachment-preview">
              <img src={attachmentPreviewUrl} alt="" />
              <button type="button" onClick={handleRemoveAttachment}>✕</button>
            </div>
          )}
          {attachmentError && <p style={{ color: 'var(--danger)' }}>{attachmentError}</p>}

          {emojiAutocompleteQuery && (
            <EmojiAutocomplete
              query={emojiAutocompleteQuery}
              currentUserId={myUid}
              onSelect={handleAutocompleteSelect}
              onFirstMatch={handleAutocompleteFirst}
            />
          )}

          <form onSubmit={handleSend} className="message-composer">
            {showEmojiPicker && (
              <EmojiPicker
                currentUserId={pb.authStore.model.id}
                anchorRect={emojiAnchor}
                onSelect={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
            <input
              ref={attachmentInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleAttachmentPick}
            />
            <button
              type="button"
              className="message-composer-icon-btn"
              onClick={() => attachmentInputRef.current?.click()}
              title="Attach an image"
            >
              📎
            </button>
            <input
              ref={composerInputRef}
              type="text"
              placeholder={`Message #${channel.name}`}
              value={content}
              onChange={handleContentChange}
              onKeyDown={(e) => {
                if (!emojiAutocompleteQuery) return
                if (e.key === 'Escape') { setEmojiAutocompleteQuery(null); return }
                if (e.key === 'Enter' && autocompleteFirstRef.current) {
                  e.preventDefault()
                  handleAutocompleteSelect(autocompleteFirstRef.current)
                }
              }}
              maxLength={charLimit}
              className="message-composer-input"
            />
            <button
              ref={emojiBtnRef}
              type="button"
              className="message-composer-icon-btn"
              onClick={() => {
                setEmojiAutocompleteQuery(null)
                setEmojiAnchor(emojiBtnRef.current?.getBoundingClientRect() || null)
                setShowEmojiPicker((v) => !v)
              }}
            >
              😊
            </button>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? 'Sending...' : 'Send'}
            </button>
          </form>
          {charsRemaining <= 500 && (
            <p className="message-composer-counter" style={{ color: charsRemaining <= 0 ? 'var(--danger)' : 'var(--text)' }}>
              {charsRemaining} characters remaining
            </p>
          )}
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>
      </div>

      {members && (
        <MembersSidebar
          members={members}
          ownerName={ownerName}
          ownerStatus={ownerStatus}
          ownerAvatarUrl={ownerAvatarUrl}
          ownerLastSeen={ownerLastSeen}
          serverId={channel.server}
          ownerId={server?.owner}
          showOfflineMembers={!!showOfflineMembers}
          onStartCall={onStartCallWithUser}
          onMessage={onMessageUser}
          onInsertMention={handleInsertMention}
        />
      )}

      {contextMenu && (
        <UserContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetUser={{ id: contextMenu.userId }}
          isSelf={contextMenu.isSelf}
          isFriend={friendUserIds.has(contextMenu.userId)}
          isBlocked={blockedUserIds.has(contextMenu.userId)}
          onClose={() => setContextMenu(null)}
          onProfile={() => setFullProfileUserId(contextMenu.userId)}
          onMention={() => handleInsertMention(contextMenu.userId)}
          onStartCall={() => onStartCallWithUser?.(contextMenu.userId)}
          onInviteToServer={() => { setInviteTargetUserId(contextMenu.userId); setContextMenu(null) }}
          onAddFriend={() => handleAddFriend(contextMenu.userId)}
          onBlock={() => handleToggleBlock(contextMenu.userId)}
        />
      )}

      {serverPopup && (
        <ServerProfilePopup
          x={serverPopup.x}
          y={serverPopup.y}
          targetUserId={serverPopup.userId}
          serverId={channel.server}
          onClose={() => setServerPopup(null)}
          onMessage={() => { onMessageUser?.(serverPopup.userId); setServerPopup(null) }}
          onViewFullProfile={() => { setFullProfileUserId(serverPopup.userId); setServerPopup(null) }}
        />
      )}

      {fullProfileUserId && (
        <FullProfileModal
          targetUserId={fullProfileUserId}
          serverId={channel.server}
          isBlocked={blockedUserIds.has(fullProfileUserId)}
          onClose={() => setFullProfileUserId(null)}
          onViewPerServerProfile={() => {
            const userId = fullProfileUserId
            setFullProfileUserId(null)
            setServerPopup({ x: window.innerWidth / 2 - 140, y: 100, userId })
          }}
          onInviteToServer={() => { setInviteTargetUserId(fullProfileUserId); setFullProfileUserId(null) }}
          onBlock={() => handleToggleBlock(fullProfileUserId)}
          onReport={() => handleReportUserProfile(fullProfileUserId)}
          onMessage={() => { onMessageUser?.(fullProfileUserId); setFullProfileUserId(null) }}
        />
      )}

      {inviteTargetUserId && (
        <InviteToServerModal
          serverId={channel.server}
          targetUserId={inviteTargetUserId}
          onClose={() => setInviteTargetUserId(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete message"
          message="Are you sure you want to delete this message? This can't be undone."
          onConfirm={() => performMessageDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

export default ChannelView