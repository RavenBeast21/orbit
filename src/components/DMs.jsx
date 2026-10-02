// DMs.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import pb from '../pocketbase'
import { getEffectiveStatus } from '../presence'
import { ensureKeypair, getMyPrivateKey, encryptMessage, decryptMessage } from '../crypto'
import EmojiPicker, { renderMessageContent as renderEmojiTokens } from './EmojiPicker'
import DMCall from './DMCall'
import FilteredImage from './FilteredImage'
import { SpamFilteredText, BurstGuard } from './SpamFilteredText'
import { maybeConvertEmoticons } from '../textUtils'
import { formatDateTime } from '../formatting'
import { markRead } from '../unread'
import { toggleBookmark, loadBookmarkedMessageIds } from '../bookmarks'
import { useReactions } from '../reactions'
import ReactionBar from './ReactionBar'
import EmojiAutocomplete from './EmojiAutocomplete'
import QuickReactions from './QuickReactions'
import ConfirmDialog from './ConfirmDialog'
import PinnedMessages from './PinnedMessages'
import { loadThreads } from '../dmStore'
import { POCKETBASE_URL } from '../config'

function DMs({ onBack, openThreadWithUserId, clearOpenThreadRequest, setActiveConversation, autoStartCallUserId, clearAutoStartCallRequest, highlightMessageId, onHighlightConsumed }) {
  // Same reasoning as MembersSidebar.jsx — staleness (going offline) is
  // only ever noticed by comparing last_seen against the current time, so
  // without a periodic re-render nothing would ever detect someone going
  // silent (e.g. just closing their tab) once their last event has passed.
  const [, forcePresenceTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => forcePresenceTick((t) => t + 1), 15000)
    return () => clearInterval(interval)
  }, [])
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  // Shared pinned messages (Batch 1) — visible to both participants.
  const [pinnedMessages, setPinnedMessages] = useState([])
  const [pinnedLoaded, setPinnedLoaded] = useState(false)
  const [jumpMessageId, setJumpMessageId] = useState(null)
  const [content, setContent] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emojiAutocompleteQuery, setEmojiAutocompleteQuery] = useState(null)
  const [emojiCache, setEmojiCache] = useState({})
  const pendingEmojiFetchesRef = useRef(new Set())
  const [error, setError] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [pendingDmRequests, setPendingDmRequests] = useState([])
  const [sending, setSending] = useState(false)
  const [reportingId, setReportingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [reportConsent, setReportConsent] = useState(false)
  const [pendingConsentRequest, setPendingConsentRequest] = useState(null)
  const [consentResponding, setConsentResponding] = useState(false)

  // Call state for the active thread — activeCall holds { isInitiator }
  // once either we've started a call or an incoming ringing call was
  // detected. null means no call UI is showing.
  const [activeCall, setActiveCall] = useState(null)
  // DM call history (report §4.42).
  const [showCallLog, setShowCallLog] = useState(false)
  const [callLog, setCallLog] = useState([])
  const [callLogLoading, setCallLogLoading] = useState(false)

  const openCallLog = async () => {
    if (!activeThread) return
    setShowCallLog(true)
    setCallLogLoading(true)
    try {
      const rows = await pb.collection('dm_calls').getFullList({
        filter: `dm_thread="${activeThread.id}" && status != "ringing"`,
        sort: '-created',
        requestKey: null,
      })
      setCallLog(rows)
    } catch (err) {
      console.error('Load call log error:', err)
    } finally {
      setCallLogLoading(false)
    }
  }

  const formatCallDuration = (row) => {
    if (!row.ended_at) return 'In progress'
    const ms = new Date(row.ended_at).getTime() - new Date(row.created).getTime()
    if (!(ms > 0)) return '<1s'
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    return minutes > 0 ? `${minutes}m ${totalSeconds % 60}s` : `${totalSeconds}s`
  }

  const [attachmentFile, setAttachmentFile] = useState(null)
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState(null)
  const [attachmentError, setAttachmentError] = useState('')
  const attachmentInputRef = useRef(null)
  // Which encrypted images the viewer has actually clicked to decrypt +
  // render, keyed by message id — click-to-reveal, per the requirement
  // that even old images stay collapsed until explicitly opened. This is
  // plain component state, so it naturally resets whenever a message
  // scrolls out of the loaded window (see the pagination/eviction logic
  // above) — no extra cleanup needed.
  const [revealedImageIds, setRevealedImageIds] = useState(new Set())

  // DM images are capped smaller than server attachments (10MB) — base64
  // + encryption overhead roughly adds another third on top of the raw
  // file size, and this all lives in a single Text field on dm_messages
  // rather than PocketBase's file storage (the whole point: nothing
  // server-side ever sees a decryptable image, only this ciphertext).
  const MAX_DM_IMAGE_BYTES = 3 * 1024 * 1024

  const handleAttachmentPick = (e) => {
    setAttachmentError('')
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setAttachmentError('Only image files can be attached right now')
      return
    }
    if (file.size > MAX_DM_IMAGE_BYTES) {
      setAttachmentError('Image must be under 3MB in DMs (end-to-end encryption adds overhead, so DMs cap smaller than servers)')
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

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1]) // strip the data: URL prefix, keep just the base64 payload
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  // DM character limit — enforced HERE client-side only, since content is
  // E2E-encrypted before it ever reaches the server; the server has no way
  // to check a real plaintext length (see pb_hooks/message_limits.pb.js
  // for the full explanation of why this differs from server messages).
  const myTier = pb.authStore.model?.subscription_tier
  const charLimit = myTier === 'premium' ? 4000 : myTier === 'plus' ? 3000 : 2000
  const charsRemaining = charLimit - content.length

  const hasAutoStartedCallRef = useRef(false)

  const uid = pb.authStore.model.id

  // Shared pinned messages for the open thread (Batch 1). Bodies are E2EE, so
  // records are stored raw here and decrypted at render like the message list.
  const loadPinnedMessages = async (threadId) => {
    if (!threadId) {
      setPinnedMessages([])
      setPinnedLoaded(true)
      return
    }
    try {
      const rows = await pb.collection('dm_messages').getFullList({
        filter: `dm_thread="${threadId}" && pinned=true`,
        sort: '-created',
        expand: 'sender',
        requestKey: null,
      })
      setPinnedMessages(rows)
    } catch (err) {
      console.error('Load pinned DM messages error:', err)
    } finally {
      setPinnedLoaded(true)
    }
  }

  const emojiBtnRef = useRef(null)
  const composerInputRef = useRef(null)
  const autocompleteFirstRef = useRef(null)
  const [emojiAnchor, setEmojiAnchor] = useState(null)

  // Reactions for the open DM thread (metadata only — message bodies stay E2EE).
  const { byTarget: reactionsByTarget, toggle: toggleReaction } = useReactions({
    scopeField: 'thread',
    scopeId: activeThread?.id,
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

  const isFriendWith = async (targetUserId) => {
    const friendsA = await pb.collection('friends').getFullList({
      filter: `user_a="${uid}" && user_b="${targetUserId}"`,
    })
    const friendsB = await pb.collection('friends').getFullList({
      filter: `user_a="${targetUserId}" && user_b="${uid}"`,
    })
    return friendsA.length > 0 || friendsB.length > 0
  }

  const openOrCreateThread = async (targetUserId) => {
    setError('')

    try {
      const targetUser = await pb.collection('users').getOne(targetUserId)
      const dmPrivacy = targetUser.dm_privacy || 'request_to_dm'

      if (dmPrivacy === 'no_one') {
        setError(`${targetUser.name} isn't accepting DMs right now`)
        return
      }

      if (dmPrivacy === 'friends_only' || dmPrivacy === 'request_to_dm') {
        const areFriends = await isFriendWith(targetUserId)
        if (!areFriends) {
          if (dmPrivacy === 'friends_only') {
            setError('You can only DM your friends')
            return
          }

          // request_to_dm — friends bypass this (handled above). For
          // everyone else the server only allows a thread once an accepted
          // dm_request exists between the two users. Reuse an accepted
          // request if one exists, otherwise send a new request.
          const existingThread = await pb.collection('dm_threads').getFullList({
            filter: `(user_a="${uid}" && user_b="${targetUserId}") || (user_a="${targetUserId}" && user_b="${uid}")`,
            requestKey: null,
          })
          if (existingThread.length === 0) {
            const existingRequests = await pb.collection('dm_requests').getFullList({
              filter: `(from_user="${uid}" && to_user="${targetUserId}") || (from_user="${targetUserId}" && to_user="${uid}")`,
              requestKey: null,
            })
            const accepted = existingRequests.find((r) => r.status === 'accepted')
            const pendingFromMe = existingRequests.find((r) => r.status === 'pending' && r.from_user === uid)

            if (!accepted) {
              if (pendingFromMe) {
                setError(`You've already sent ${targetUser.name} a DM request.`)
                return
              }
              await pb.collection('dm_requests').create({
                from_user: uid,
                to_user: targetUserId,
                status: 'pending',
              })
              setError('')
              setInfoMessage(`DM request sent to ${targetUser.name}. You can message them once they accept.`)
              return
            }
          }
        }
      }
      // dmPrivacy === 'everyone' falls through with no restriction.

      const existing = await pb.collection('dm_threads').getFullList({
        filter: `(user_a="${uid}" && user_b="${targetUserId}") || (user_a="${targetUserId}" && user_b="${uid}")`,
      })

      let threadId
      if (existing.length > 0) {
        threadId = existing[0].id
      } else {
        const created = await pb.collection('dm_threads').create({
          user_a: uid,
          user_b: targetUserId,
        })
        threadId = created.id
      }

      const updatedThreads = await loadThreads(uid)
      const thread = updatedThreads.find((t) => t.id === threadId)
      setActiveThread(thread || { id: threadId, otherUser: targetUser })
    } catch (err) {
      console.error(err)
      setError('Something went wrong opening this conversation')
    }
  }

  const loadDmRequests = async () => {
    try {
      const records = await pb.collection('dm_requests').getFullList({
        filter: `to_user="${uid}" && status="pending"`,
        expand: 'from_user',
        sort: '-created',
        requestKey: null,
      })
      setPendingDmRequests(records)
    } catch (err) {
      console.error('Load DM requests error:', err)
    }
  }

  const handleAcceptDmRequest = async (request) => {
    setError('')
    try {
      // The server hook atomically creates the dm_thread when the request
      // is accepted, so a reload of the thread list will include it.
      await pb.collection('dm_requests').update(request.id, { status: 'accepted' })
      const updated = await loadThreads(uid)
      const thread = updated.find((t) => t.otherUser?.id === request.from_user)
      if (thread) setActiveThread(thread)
      loadDmRequests()
    } catch (err) {
      console.error('Accept DM request error:', err)
      setError('Could not accept that DM request')
    }
  }

  const handleDeclineDmRequest = async (request) => {
    try {
      await pb.collection('dm_requests').update(request.id, { status: 'declined' })
      loadDmRequests()
    } catch (err) {
      console.error('Decline DM request error:', err)
    }
  }

  useEffect(() => {
    ensureKeypair()
    loadThreads(uid)
    loadDmRequests()

    let unsubRequests
    pb.collection('dm_requests').subscribe('*', (e) => {
      if (e.record.to_user === uid || e.record.from_user === uid) {
        loadDmRequests()
      }
    }).then((fn) => { unsubRequests = fn })

    return () => { if (unsubRequests) unsubRequests() }
  }, [])

  // React to every open-thread request, not just the first one, so switching
  // DM threads from the sidebar while already on the DMs page works.
  useEffect(() => {
    if (!openThreadWithUserId) return
    // Deferred so this isn't a synchronous setState-in-effect call.
    const timer = setTimeout(() => {
      openOrCreateThread(openThreadWithUserId)
      clearOpenThreadRequest()
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadWithUserId])

  useEffect(() => {
    if (setActiveConversation) {
      if (activeThread) {
        setActiveConversation({ type: 'dm', id: activeThread.id })
        markRead('dm', activeThread.id)
      } else {
        setActiveConversation(null)
      }
    }
  }, [activeThread])

  // Once the thread we were asked to auto-start a call on is actually
  // open, kick off the call (once — the ref guards against re-firing on
  // unrelated re-renders of this effect).
  useEffect(() => {
    if (
      autoStartCallUserId &&
      activeThread &&
      activeThread.otherUser?.id === autoStartCallUserId &&
      !hasAutoStartedCallRef.current
    ) {
      hasAutoStartedCallRef.current = true
      setActiveCall({ isInitiator: true })
      clearAutoStartCallRequest?.()
    }
  }, [autoStartCallUserId, activeThread])

  // Watch for an incoming ringing call on whichever thread is open, so a
  // call started FROM THE OTHER SIDE shows up here too, not just calls we
  // initiate ourselves.
  useEffect(() => {
    if (!activeThread) return
    let cancelled = false

    const checkForRingingCall = async () => {
      try {
        const ringing = await pb.collection('dm_calls').getFullList({
          filter: `dm_thread="${activeThread.id}" && status="ringing" && caller!="${uid}"`,
          requestKey: null,
        })
        if (!cancelled && ringing.length > 0 && !activeCall) {
          setActiveCall({ isInitiator: false })
        }
      } catch (err) {
        console.error('Check ringing call error:', err)
      }
    }

    checkForRingingCall()

    let unsub
    pb.collection('dm_calls').subscribe('*', (e) => {
      if (e.record.dm_thread !== activeThread.id) return
      if (e.action === 'create' && e.record.status === 'ringing' && e.record.caller !== uid) {
        setActiveCall((prev) => prev || { isInitiator: false })
      }
    }).then((fn) => { unsub = fn })

    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [activeThread?.id])

  useEffect(() => {
    let unsub

    pb.collection('users').subscribe('*', (e) => {
      if (e.action !== 'update') return

      // The DM conversation list is owned by dmStore.js; only the open thread
      // needs live user updates (status + public_key for sending).
      setActiveThread((prev) =>
        prev && prev.otherUser?.id === e.record.id
          ? { ...prev, otherUser: { ...prev.otherUser, status: e.record.status, public_key: e.record.public_key } }
          : prev
      )
    }).then((fn) => {
      unsub = fn
    })

    return () => {
      if (unsub) unsub()
    }
  }, [])

  // Windowed message loading — a DM thread's ENTIRE history used to be
  // fetched in one getFullList call every time it opened, which only gets
  // slower the longer a conversation runs. Instead:
  //   - open a thread -> fetch just the most recent BATCH_SIZE messages
  //   - scroll near the top -> fetch the next older BATCH_SIZE
  //   - once more than MAX_LOADED messages are held in memory, trim from
  //     the NEWEST end (the end furthest from wherever you've scrolled to
  //     while paging up through history) — scrolling back down past that
  //     trimmed boundary re-fetches that recent chunk fresh rather than
  //     holding the whole thread in memory indefinitely.
  const BATCH_SIZE = 40
  const MAX_LOADED = 120
  const [hasMoreOlder, setHasMoreOlder] = useState(true)
  const [hasMoreNewer, setHasMoreNewer] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const messageListRef = useRef(null)
  const prevScrollHeightRef = useRef(0)
  const stickToBottomRef = useRef(true)
  // Bookmarks jump: briefly flash the target message after scrolling to it.
  const [flashMessageId, setFlashMessageId] = useState(null)

  // When `anchorMessageId` is given (bookmark jump), load a window of
  // messages around it instead of the newest page, so a bookmark from deep in
  // history can still be scrolled to.
  const loadMessages = async (threadId, anchorMessageId) => {
    try {
      if (anchorMessageId) {
        let anchor
        try {
          anchor = await pb.collection('dm_messages').getOne(anchorMessageId, { requestKey: null })
        } catch {
          anchor = null
        }
        if (anchor) {
          const [older, newer] = await Promise.all([
            pb.collection('dm_messages').getList(1, BATCH_SIZE, {
              filter: `dm_thread="${threadId}" && created <= "${anchor.created}"`,
              sort: '-created',
              expand: 'sender',
              requestKey: null,
            }),
            pb.collection('dm_messages').getList(1, 20, {
              filter: `dm_thread="${threadId}" && created > "${anchor.created}"`,
              sort: 'created',
              expand: 'sender',
              requestKey: null,
            }),
          ])
          setMessages([...older.items.reverse(), ...newer.items])
          setHasMoreOlder(older.items.length === BATCH_SIZE)
          setHasMoreNewer(newer.items.length === 20)
          stickToBottomRef.current = false
          return
        }
      }

      const page = await pb.collection('dm_messages').getList(1, BATCH_SIZE, {
        filter: `dm_thread="${threadId}"`,
        sort: '-created', // newest first from the API...
        expand: 'sender',
        requestKey: null,
      })
      setMessages(page.items.reverse()) // ...then reversed to display oldest-to-newest, as before
      setHasMoreOlder(page.items.length === BATCH_SIZE)
      setHasMoreNewer(false) // freshly opened thread — already at the live tail
    } catch (err) {
      console.error(err)
    }
  }

  const loadOlderMessages = async () => {
    if (!activeThread || loadingOlder || !hasMoreOlder || messages.length === 0) return
    setLoadingOlder(true)

    // Preserve scroll position across the prepend — without this, adding
    // content above the current view yanks the scroll position down by
    // however tall the new content is, which reads as the view suddenly
    // jumping while you're mid-scroll.
    if (messageListRef.current) {
      prevScrollHeightRef.current = messageListRef.current.scrollHeight
    }

    try {
      const oldestLoaded = messages[0]
      const page = await pb.collection('dm_messages').getList(1, BATCH_SIZE, {
        filter: `dm_thread="${activeThread.id}" && created < "${oldestLoaded.created}"`,
        sort: '-created',
        expand: 'sender',
        requestKey: null,
      })

      const olderBatch = page.items.reverse()
      setMessages((prev) => {
        const combined = [...olderBatch, ...prev]
        if (combined.length > MAX_LOADED) {
          // Trim from the newest end to cap memory — the gap this leaves
          // gets re-fetched by loadNewerMessages if you scroll back down
          // past it.
          setHasMoreNewer(true)
          return combined.slice(0, MAX_LOADED)
        }
        return combined
      })
      setHasMoreOlder(page.items.length === BATCH_SIZE)
    } catch (err) {
      console.error('Load older messages error:', err)
    } finally {
      setLoadingOlder(false)
    }
  }

  const loadNewerMessages = async () => {
    if (!activeThread || loadingNewer || !hasMoreNewer || messages.length === 0) return
    setLoadingNewer(true)

    try {
      const newestLoaded = messages[messages.length - 1]
      const page = await pb.collection('dm_messages').getList(1, BATCH_SIZE, {
        filter: `dm_thread="${activeThread.id}" && created > "${newestLoaded.created}"`,
        sort: 'created',
        expand: 'sender',
        requestKey: null,
      })

      setMessages((prev) => {
        const combined = [...prev, ...page.items]
        if (page.items.length < BATCH_SIZE) setHasMoreNewer(false)
        return combined
      })
    } catch (err) {
      console.error('Load newer messages error:', err)
    } finally {
      setLoadingNewer(false)
    }
  }

  // Opening a thread jumps to the newest message; appends keep it pinned
  // there while the user is already at the bottom. Prepends still restore the
  // previous scroll position (see loadOlderMessages above).
  useEffect(() => {
    stickToBottomRef.current = true
  }, [activeThread?.id])

  useEffect(() => {
    const el = messageListRef.current
    if (!el) return
    if (prevScrollHeightRef.current) {
      const newScrollHeight = el.scrollHeight
      el.scrollTop += newScrollHeight - prevScrollHeightRef.current
      prevScrollHeightRef.current = 0
    } else if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const handleMessageListScroll = () => {
    const el = messageListRef.current
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom < 80

    if (el.scrollTop < 100) loadOlderMessages()
    if (distanceFromBottom < 100) loadNewerMessages()
  }

  useEffect(() => {
    if (!activeThread) return

    setPinnedLoaded(false)
    setPinnedMessages([])
    loadMessages(activeThread.id)
    loadPinnedMessages(activeThread.id)
    checkPendingConsentRequest(activeThread.id)

    let unsub

    pb.collection('dm_messages').subscribe('*', async (e) => {
      if (e.record.dm_thread !== activeThread.id) return
      if (e.action === 'create') {
        if (hasMoreNewer) return // we're scrolled up past a trimmed gap — this new message belongs beyond what's currently loaded, loadNewerMessages will pick it up once the gap is closed
        const fullRecord = await pb.collection('dm_messages').getOne(e.record.id, {
          expand: 'sender',
          requestKey: null,
        })
        // Dedupe: the sender may have already inserted this optimistically.
        setMessages((prev) => (
          prev.some((m) => m.id === fullRecord.id) ? prev : [...prev, fullRecord]
        ))
      } else if (e.action === 'delete') {
        setMessages((prev) => prev.filter((m) => m.id !== e.record.id))
        loadPinnedMessages(activeThread.id)
      } else if (e.action === 'update') {
        // Keeps the pinned panel in sync when either participant pins/unpins.
        loadPinnedMessages(activeThread.id)
      }
    }).then((fn) => {
      unsub = fn
    })

    return () => {
      if (unsub) unsub()
    }
  }, [activeThread?.id])

  // Bookmark jump: scroll to and flash the saved DM message. If it isn't in
  // the loaded window, re-load an anchored window around it first, then this
  // effect runs again once it arrives.
  useEffect(() => {
    if (!highlightMessageId || !activeThread) return
    if (!messages.some((m) => m.id === highlightMessageId)) {
      // Deferred so the load isn't a synchronous call within the effect body.
      const load = setTimeout(() => loadMessages(activeThread.id, highlightMessageId), 0)
      return () => clearTimeout(load)
    }
    stickToBottomRef.current = false
    const el = document.getElementById(`msg-${highlightMessageId}`)
    if (el) el.scrollIntoView({ block: 'center' })
    const show = setTimeout(() => setFlashMessageId(highlightMessageId), 0)
    onHighlightConsumed?.()
    return () => clearTimeout(show)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMessageId, activeThread?.id, messages])

  // Separate timer so the highlight always clears even after the jump prop is
  // consumed (see the equivalent effect in ChannelView).
  useEffect(() => {
    if (!flashMessageId) return
    const timer = setTimeout(() => setFlashMessageId(null), 3000)
    return () => clearTimeout(timer)
  }, [flashMessageId])

  // Pinned-message jump. DM history is paginated, so if the target isn't in
  // the loaded window, reuse the anchored loader (same path as bookmarks) and
  // let this effect run again once it arrives.
  useEffect(() => {
    if (!jumpMessageId || !activeThread) return
    if (!messages.some((m) => m.id === jumpMessageId)) {
      const load = setTimeout(() => loadMessages(activeThread.id, jumpMessageId), 0)
      return () => clearTimeout(load)
    }
    stickToBottomRef.current = false
    const el = document.getElementById(`msg-${jumpMessageId}`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const show = setTimeout(() => setFlashMessageId(jumpMessageId), 0)
    const clear = setTimeout(() => setJumpMessageId(null), 0)
    return () => {
      clearTimeout(show)
      clearTimeout(clear)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpMessageId, activeThread?.id, messages])

  const checkPendingConsentRequest = async (threadId) => {
    try {
      const records = await pb.collection('dm_search_consents').getFullList({
        filter: `thread="${threadId}" && target_user="${uid}" && status="pending"`,
      })
      setPendingConsentRequest(records[0] || null)
    } catch (err) {
      console.error('Check consent request error:', err)
      setPendingConsentRequest(null)
    }
  }

  const handleRespondToConsentRequest = async (approve) => {
    if (!pendingConsentRequest) return
    setConsentResponding(true)
    try {
      await pb.collection('dm_search_consents').update(pendingConsentRequest.id, {
        status: approve ? 'granted' : 'denied',
      })
      setPendingConsentRequest(null)
    } catch (err) {
      console.error('Respond to consent request error:', err)
    } finally {
      setConsentResponding(false)
    }
  }

  const handleSend = async (e) => {
    e.preventDefault()
    setError('')

    if (!content.trim() && !attachmentFile) {
      setError('Message cannot be empty')
      return
    }

    if (content.length > charLimit) {
      setError(`Your message is too long (${content.length}/${charLimit} characters). Upgrade to Orbit+ or Premium for a higher limit.`)
      return
    }

    // Custom emojis in DMs are an Orbit+/Premium perk (there's no "home
    // server" context in a DM, so any custom emoji token here counts as
    // "outside its own server"). This check is CLIENT-SIDE ONLY — DM
    // content is encrypted before the server ever sees it, so unlike
    // server messages (enforced in pb_hooks/emoji_usage.pb.js), this
    // can't be verified server-side. Same accepted-gap category as the
    // DM character limit.
    const myTierForEmoji = pb.authStore.model?.subscription_tier
    const hasEmojiPlan = myTierForEmoji === 'plus' || myTierForEmoji === 'premium'
    if (!hasEmojiPlan && /:[^:\s]+:[a-zA-Z0-9]{15}:/.test(content)) {
      setError('Using a custom emoji in DMs is an Orbit+/Premium perk.')
      return
    }

    const theirPublicKey = activeThread.otherUser?.public_key
    const myPrivateKey = getMyPrivateKey()

    if (!theirPublicKey) {
      setError(`${activeThread.otherUser?.name || 'This user'} hasn't set up encryption yet — they need to log in once on the updated app before you can message them.`)
      return
    }

    if (!myPrivateKey) {
      setError('Your encryption key is missing on this device. Try refreshing the page.')
      return
    }

    setSending(true)

    try {
      // Text and images share the SAME content field and the SAME
      // encrypt/decrypt functions — an image is just a JSON envelope
      // ({ kind: 'image', ... }) encrypted as if it were the plaintext
      // string. Every message ever sent before this feature existed is a
      // plain string, not JSON, so decryptMessage's caller can tell them
      // apart by attempting JSON.parse and checking for kind === 'image'
      // — old messages just fail that parse and render as text, exactly
      // as before. No schema change, no migration needed.
      const outgoing = maybeConvertEmoticons(content, pb.authStore.model?.ascii_emoticons)

      let plaintextPayload = outgoing

      if (attachmentFile) {
        const base64Data = await fileToBase64(attachmentFile)
        plaintextPayload = JSON.stringify({
          kind: 'image',
          mime: attachmentFile.type,
          data: base64Data,
          caption: outgoing || undefined,
        })
      }

      const encryptedContent = encryptMessage(plaintextPayload, theirPublicKey, myPrivateKey)

      const created = await pb.collection('dm_messages').create({
        dm_thread: activeThread.id,
        sender: uid,
        content: encryptedContent,
        content_kind: attachmentFile ? 'image' : 'text',
      })
      // Show the sender's own message immediately, without waiting for the
      // realtime echo. The realtime handler dedupes by id, so this can never
      // produce a duplicate. `expand.sender` is attached so the row renders
      // exactly like a realtime-delivered one.
      setMessages((prev) => (
        prev.some((m) => m.id === created.id)
          ? prev
          : [...prev, { ...created, expand: { sender: pb.authStore.model } }]
      ))
      setContent('')
      handleRemoveAttachment()
    } catch (err) {
      console.error(err)
      setError('Something went wrong sending the message')
    } finally {
      setSending(false)
    }
  }

  const handleReportUser = async () => {
    if (!activeThread?.otherUser?.id) return
    try {
      await pb.collection('reports').create({
        reported_by: pb.authStore.model.id,
        target_type: 'user',
        target_id: activeThread.otherUser.id,
        reason: 'Reported from DM profile panel',
        status: 'pending',
      })
      setReportStatus('User reported')
      setTimeout(() => setReportStatus(''), 2000)
    } catch (err) {
      console.error('Report user error:', err)
    }
  }

  const handleSubmitReport = async (messageId) => {
    if (!reportReason.trim()) {
      setReportStatus('Please enter a reason')
      return
    }

    try {
      const report = await pb.collection('reports').create({
        reported_by: uid,
        target_type: 'dm_message',
        target_id: messageId,
        reason: reportReason,
        status: 'pending',
      })

      if (reportConsent && activeThread) {
        await pb.collection('dm_search_consents').create({
          report: report.id,
          thread: activeThread.id,
          target_user: uid,
          status: 'granted',
        })
      }

      setReportStatus('Report submitted')
      setReportReason('')
      setReportConsent(false)
      setTimeout(() => {
        setReportingId(null)
        setReportStatus('')
      }, 1500)
    } catch (err) {
      console.error(err)
      setReportStatus('Something went wrong submitting the report')
    }
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

  const performDmDelete = async (msg) => {
    setDeleteTarget(null)
    try {
      await pb.collection('dm_messages').delete(msg.id)
      setMessages((prev) => prev.filter((m) => m.id !== msg.id))
    } catch (err) {
      console.error('Delete DM message error:', err)
      setError('Could not delete that message')
    }
  }

  // Personal bookmarks for the open DM thread (report §4.23). DM bodies stay
  // E2EE — only a short decrypted snapshot is stored in the user's own
  // private bookmark row.
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set())

  useEffect(() => {
    if (!uid || !activeThread?.id) return
    let cancelled = false
    loadBookmarkedMessageIds(uid, { threadId: activeThread.id }).then((ids) => {
      if (!cancelled) setBookmarkedIds(ids)
    })
    return () => { cancelled = true }
  }, [activeThread?.id, uid])

  const getPlaintextForBookmark = (msg) => {
    const theirPublicKey = activeThread?.otherUser?.public_key
    const myPrivateKey = getMyPrivateKey()
    if (!theirPublicKey || !myPrivateKey) return ''
    const { text } = decryptMessage(msg.content, theirPublicKey, myPrivateKey)
    try {
      const parsed = JSON.parse(text)
      if (parsed && parsed.kind === 'image') return '[image]'
    } catch {
      // ordinary text
    }
    return text || ''
  }

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
        userId: uid,
        messageId: msg.id,
        threadId: activeThread.id,
        content: getPlaintextForBookmark(msg),
        authorName: msg.expand?.sender?.name || '',
        sourceLabel: `DM · ${activeThread.otherUser?.name || 'Unknown'}`,
      })
    } catch (err) {
      console.error('Toggle DM bookmark error:', err)
      setBookmarkedIds((prev) => {
        const next = new Set(prev)
        if (willAdd) next.delete(msg.id)
        else next.add(msg.id)
        return next
      })
    }
  }

  // Shared pin state — either participant may pin/unpin a message for the
  // whole conversation. The body stays E2EE; only the `pinned` flag changes.
  const handleToggleDmPin = async (msg) => {
    const next = !msg.pinned
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, pinned: next } : m)))
    setPinnedMessages((prev) => (next ? prev : prev.filter((p) => p.id !== msg.id)))
    try {
      // Pinning goes through a dedicated endpoint: dm_messages deliberately
      // has no client updateRule (that would let either participant rewrite
      // the other's encrypted content), so the backend only allows flipping
      // this one boolean for a real participant.
      const response = await fetch(`${POCKETBASE_URL}/api/orbit/dm-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ messageId: msg.id, pinned: next }),
      })
      if (!response.ok) throw new Error('Could not update the pin')
      loadPinnedMessages(activeThread.id)
    } catch (err) {
      console.error('Toggle DM pin error:', err)
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, pinned: !next } : m)))
      loadPinnedMessages(activeThread.id)
    }
  }

  const handleUnpinDmById = (id) => {
    const msg = pinnedMessages.find((p) => p.id === id)
    return msg ? handleToggleDmPin(msg) : Promise.resolve()
  }

  const renderMessageText = (msg) => {
    const theirPublicKey = activeThread?.otherUser?.public_key
    const myPrivateKey = getMyPrivateKey()

    if (!theirPublicKey || !myPrivateKey) {
      console.warn('[Orbit E2EE] Cannot decrypt message right now — missing key at render time:', {
        messageId: msg.id,
        haveTheirPublicKey: !!theirPublicKey,
        haveMyPrivateKey: !!myPrivateKey,
        activeThreadOtherUser: activeThread?.otherUser,
      })
      return '[Decrypting...]'
    }

    const { text } = decryptMessage(msg.content, theirPublicKey, myPrivateKey)

    // Image messages are the SAME encrypted content field as text — just
    // a JSON envelope instead of a plain string. Every message from
    // before this feature existed is a plain string and fails this
    // parse, falling straight through to the text path below exactly as
    // it always did.
    let imageEnvelope = null
    try {
      const parsed = JSON.parse(text)
      if (parsed && parsed.kind === 'image' && parsed.data) imageEnvelope = parsed
    } catch {
      // Not JSON — this is an ordinary text message, nothing to do here.
    }

    if (imageEnvelope) {
      const isRevealed = revealedImageIds.has(msg.id)
      return (
        <div>
          {isRevealed ? (
            <FilteredImage
              dataUrl={`data:${imageEnvelope.mime};base64,${imageEnvelope.data}`}
              senderId={msg.sender}
              alt="attachment"
            />
          ) : (
            <button
              type="button"
              className="dm-image-reveal-btn"
              onClick={() => setRevealedImageIds((prev) => new Set(prev).add(msg.id))}
            >
              🖼️ Click to view image
            </button>
          )}
          {imageEnvelope.caption && <div className="message-content">{renderEmojiTokens(imageEnvelope.caption, emojiCache)}</div>}
        </div>
      )
    }

    // Emoji tokens live INSIDE the encrypted text, so we only know about
    // them after decrypting — lazily fetch any we haven't cached yet
    // (fire-and-forget, guarded against duplicate requests via the ref
    // below; this render pass shows the raw token, the next one — once
    // the cache updates — shows the real image).
    const tokenPattern = /:[^:\s]+:([a-zA-Z0-9]{15}):/g
    let match
    while ((match = tokenPattern.exec(text)) !== null) {
      const emojiId = match[1]
      if (!emojiCache[emojiId] && !pendingEmojiFetchesRef.current.has(emojiId)) {
        pendingEmojiFetchesRef.current.add(emojiId)
        pb.collection('emojis').getOne(emojiId)
          .then((emoji) => setEmojiCache((prev) => ({ ...prev, [emojiId]: emoji })))
          .catch(() => {}) // deleted/invalid id — stays a raw token, handled gracefully
      }
    }

    return (
      <SpamFilteredText senderId={msg.sender} text={text}>
        {renderEmojiTokens(text, emojiCache)}
      </SpamFilteredText>
    )
  }

  if (activeThread) {
    return (
      <div className="channel-view-shell">
        <div className="channel-main">
          <div className="channel-topbar">
            {activeThread.otherUser?.avatar ? (
              <img src={pb.files.getURL(activeThread.otherUser, activeThread.otherUser.avatar, { thumb: '32x32' })} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--surface-2)' }} />
            )}
            <h2>{activeThread.otherUser?.name || 'Unknown'}</h2>
            <span style={{ color: 'var(--text)', fontSize: '0.85em', textTransform: 'capitalize' }}>
              {getEffectiveStatus(activeThread.otherUser)}
            </span>
            <div className="channel-topbar-actions">
              {!activeCall && (
                <button
                  className="channel-topbar-call-btn"
                  onClick={() => setActiveCall({ isInitiator: true })}
                  title="Start a Call"
                >
                  📞
                </button>
              )}
              <button
                className="channel-topbar-call-btn"
                onClick={openCallLog}
                title="Call history"
              >
                🕘
              </button>
              <PinnedMessages
                loading={!pinnedLoaded}
                items={pinnedMessages.map((pm) => ({
                  id: pm.id,
                  authorName: pm.expand?.sender?.name || 'Unknown',
                  avatarUrl: pm.expand?.sender?.avatar
                    ? pb.files.getURL(pm.expand.sender, pm.expand.sender.avatar, { thumb: '32x32' })
                    : null,
                  content: getPlaintextForBookmark(pm),
                  created: pm.created,
                }))}
                onJump={setJumpMessageId}
                onUnpin={handleUnpinDmById}
                emptyHint="Hover over a message and choose Pin to save it here for both of you."
              />
            </div>
          </div>

          {activeCall && (
            <DMCall
              dmThreadId={activeThread.id}
              otherUser={activeThread.otherUser}
              isInitiator={activeCall.isInitiator}
              onClose={() => setActiveCall(null)}
            />
          )}

          {pendingConsentRequest && (
            <div style={{ border: '1px solid var(--warning)', borderRadius: 'var(--radius)', padding: '12px', margin: '12px 16px 0' }}>
              <p>
                A moderator has requested to review this ENTIRE conversation as part of investigating a report you filed. Do you consent?
              </p>
              <button className="btn-primary" onClick={() => handleRespondToConsentRequest(true)} disabled={consentResponding}>
                Approve
              </button>
              {' '}
              <button onClick={() => handleRespondToConsentRequest(false)} disabled={consentResponding}>
                Deny
              </button>
            </div>
          )}

          <div className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
            {loadingOlder && <p style={{ textAlign: 'center', color: 'var(--text)' }}>Loading older messages...</p>}
            {messages.length === 0 && (
              <div className="dm-conversation-starter">
                {activeThread.otherUser?.avatar ? (
                  <img
                    src={pb.files.getURL(activeThread.otherUser, activeThread.otherUser.avatar, { thumb: '64x64' })}
                    alt=""
                    style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--surface-2)' }} />
                )}
                <h2>{activeThread.otherUser?.name}</h2>
                <p style={{ color: 'var(--text)' }}>This is the beginning of your conversation with {activeThread.otherUser?.name}.</p>
              </div>
            )}
            {messages.map((msg, index) => (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`message-row${shiftHeld && hoveredMessageId === msg.id ? ' message-row-shift' : ''}${flashMessageId === msg.id ? ' message-row-highlight' : ''}`}
                onMouseEnter={() => setHoveredMessageId(msg.id)}
                onMouseLeave={() => setHoveredMessageId((cur) => (cur === msg.id ? null : cur))}
              >
                {msg.expand?.sender?.avatar ? (
                  <img src={pb.files.getURL(msg.expand.sender, msg.expand.sender.avatar, { thumb: '32x32' })} alt="" className="message-avatar" />
                ) : (
                  <div className="message-avatar message-avatar-fallback" />
                )}
                <div className="message-body">
                  <div className="message-header">
                    <strong className="message-sender">{msg.expand?.sender?.name || 'Unknown'}</strong>
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
                    <button
                      className="message-report-btn"
                      title={msg.pinned ? 'Unpin message' : 'Pin message'}
                      onClick={() => handleToggleDmPin(msg)}
                      style={msg.pinned ? { color: 'var(--accent)' } : undefined}
                    >
                      {msg.pinned ? '📌 Unpin' : '📌'}
                    </button>
                    {msg.sender === uid && (
                      <button
                        className="message-delete-btn"
                        title="Delete message"
                        onClick={() => (shiftHeld ? performDmDelete(msg) : setDeleteTarget(msg))}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                  <div className="message-content">
                    <BurstGuard messages={messages} index={index}>
                      {renderMessageText(msg)}
                    </BurstGuard>
                  </div>

                  <ReactionBar
                    targetId={msg.id}
                    reactions={reactionsByTarget[msg.id] || []}
                    currentUserId={uid}
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
                      <div>
                        <label>
                          <input
                            type="checkbox"
                            checked={reportConsent}
                            onChange={(e) => setReportConsent(e.target.checked)}
                          />
                          {' '}Allow a moderator to review the ENTIRE conversation (not just this message) while investigating this report
                        </label>
                      </div>
                      <button onClick={() => handleSubmitReport(msg.id)}>Submit Report</button>
                      {reportStatus && <p>{reportStatus}</p>}
                    </div>
                  )}
                </div>

                {shiftHeld && hoveredMessageId === msg.id && (
                  <QuickReactions
                    onSelect={(emoji) => toggleReaction(msg.id, emoji, uid)}
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
                currentUserId={uid}
                onSelect={handleAutocompleteSelect}
                onFirstMatch={handleAutocompleteFirst}
              />
            )}

            <form onSubmit={handleSend} className="message-composer">
              {showEmojiPicker && (
                <EmojiPicker
                  currentUserId={pb.authStore.model.id}
                  anchorRect={emojiAnchor}
                  onSelect={(value) => {
                    setContent((prev) => prev + value)
                    setShowEmojiPicker(false)
                  }}
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
                placeholder={`Message ${activeThread.otherUser?.name || ''}`}
                value={content}
                onChange={(e) => {
                  const newValue = e.target.value
                  setContent(newValue)
                  const cursorPos = e.target.selectionStart
                  const beforeCursor = newValue.slice(0, cursorPos)
                  const inlineMatch = beforeCursor.match(/:([a-zA-Z0-9_]{1,30})$/)
                  setEmojiAutocompleteQuery(inlineMatch ? inlineMatch[1] : null)
                }}
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

        <div className="dm-profile-panel">
          {activeThread.otherUser?.avatar ? (
            <img
              src={pb.files.getURL(activeThread.otherUser, activeThread.otherUser.avatar, { thumb: '80x80' })}
              alt=""
              className="dm-profile-avatar"
            />
          ) : (
            <div className="dm-profile-avatar" style={{ backgroundColor: 'var(--surface-2)' }} />
          )}
          <h2>{activeThread.otherUser?.name}</h2>
          <p style={{ color: 'var(--text)' }}>@{activeThread.otherUser?.username}</p>
          <p style={{ color: 'var(--text)', textTransform: 'capitalize' }}>
            {getEffectiveStatus(activeThread.otherUser)}
          </p>
          <button className="btn-danger" onClick={handleReportUser} style={{ marginTop: '12px' }}>
            🚩 Report User
          </button>
        </div>

        {showCallLog && (
          <div className="modal-backdrop" onClick={() => setShowCallLog(false)}>
            <div className="full-profile-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px', padding: '20px' }}>
              <button className="modal-close-btn" onClick={() => setShowCallLog(false)}>✕</button>
              <h2>Call History</h2>
              {callLogLoading && <p style={{ color: 'var(--text)' }}>Loading...</p>}
              {!callLogLoading && callLog.length === 0 && (
                <p style={{ color: 'var(--text)' }}>No calls with {activeThread.otherUser?.name || 'this user'} yet.</p>
              )}
              <ul className="list-reset">
                {callLog.map((row) => {
                  const statusLabel = row.status === 'ended' ? 'Answered'
                    : row.status === 'active' ? 'In progress'
                    : row.status === 'missed' ? 'Missed'
                    : 'Declined'
                  return (
                    <li key={row.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>
                          {row.kind === 'video' ? '🎥' : '📞'} {statusLabel}
                          {row.status === 'missed' && ' · ' + (activeThread.otherUser?.name || 'They') + ' didn\'t answer'}
                        </span>
                        <span style={{ color: 'gray', fontSize: '0.85em' }}>
                          {formatDateTime(row.created)} · {formatCallDuration(row)}
                        </span>
                        <span style={{ color: 'gray', fontSize: '0.85em' }}>
                          Started by {row.caller === uid ? 'you' : (activeThread.otherUser?.name || 'them')}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}

        {deleteTarget && (
          <ConfirmDialog
            title="Delete message"
            message="Are you sure you want to delete this message? This can't be undone."
            onConfirm={() => performDmDelete(deleteTarget)}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </div>
    )
  }

  // No active thread selected — HomeSidebar already shows the full DM
  // list, so this is just a lightweight empty state, not a second copy
  // of that list. Incoming message requests (dm_privacy = request_to_dm)
  // are surfaced here so the recipient can accept or decline them.
  return (
    <div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {infoMessage && <p style={{ color: 'var(--teal)' }}>{infoMessage}</p>}

      {pendingDmRequests.length > 0 && (
        <div className="settings-block">
          <h2>Message Requests</h2>
          <ul className="list-reset">
            {pendingDmRequests.map((req) => (
              <li key={req.id} className="list-row">
                <span>{req.expand?.from_user?.name || 'Unknown'} wants to message you</span>
                <span className="list-row-actions">
                  <button className="btn-primary" onClick={() => handleAcceptDmRequest(req)}>Accept</button>
                  <button onClick={() => handleDeclineDmRequest(req)}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p>Select a conversation from the sidebar to start messaging.</p>
    </div>
  )
}

export default DMs