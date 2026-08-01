// DMs.jsx
import { useState, useEffect, useRef } from 'react'
import pb from '../pocketbase'
import { ensureKeypair, getMyPrivateKey, encryptMessage, decryptMessage } from '../crypto'

function DMs({ onBack, openThreadWithUserId, clearOpenThreadRequest, setActiveConversation }) {
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [closeFriendIds, setCloseFriendIds] = useState([])
  const [reportingId, setReportingId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [reportConsent, setReportConsent] = useState(false)
  const [pendingConsentRequest, setPendingConsentRequest] = useState(null)
  const [consentResponding, setConsentResponding] = useState(false)

  const hasOpenedRef = useRef(false)

  const uid = pb.authStore.model.id

  const loadThreads = async () => {
    try {
      const recordsA = await pb.collection('dm_threads').getFullList({
        filter: `user_a="${uid}"`,
        expand: 'user_b',
      })
      const recordsB = await pb.collection('dm_threads').getFullList({
        filter: `user_b="${uid}"`,
        expand: 'user_a',
      })

      const combined = [
        ...recordsA.map((t) => ({ id: t.id, otherUser: t.expand?.user_b })),
        ...recordsB.map((t) => ({ id: t.id, otherUser: t.expand?.user_a })),
      ]
      setThreads(combined)
      return combined
    } catch (err) {
      console.error(err)
      return []
    }
  }

  const loadCloseFriends = async () => {
    try {
      const records = await pb.collection('close_friends').getFullList({
        filter: `user="${uid}"`,
      })
      setCloseFriendIds(records.map((r) => r.friend))
    } catch (err) {
      console.error('Close friends load error:', err)
    }
  }

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
      const areFriends = await isFriendWith(targetUserId)
      if (!areFriends) {
        setError('You can only DM your friends')
        return
      }

      const targetUser = await pb.collection('users').getOne(targetUserId)

      if (targetUser.dm_privacy === 'no_one') {
        setError(`${targetUser.name} isn't accepting DMs right now`)
        return
      }

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

      const updatedThreads = await loadThreads()
      const thread = updatedThreads.find((t) => t.id === threadId)
      setActiveThread(thread || { id: threadId, otherUser: targetUser })
    } catch (err) {
      console.error(err)
      setError('Something went wrong opening this conversation')
    }
  }

  const toggleCloseFriend = async (targetUserId) => {
    try {
      if (closeFriendIds.includes(targetUserId)) {
        const records = await pb.collection('close_friends').getFullList({
          filter: `user="${uid}" && friend="${targetUserId}"`,
        })
        if (records[0]) {
          await pb.collection('close_friends').delete(records[0].id)
        }
      } else {
        await pb.collection('close_friends').create({
          user: uid,
          friend: targetUserId,
        })
      }
      loadCloseFriends()
    } catch (err) {
      console.error('Close friend toggle error:', err)
    }
  }

  useEffect(() => {
    ensureKeypair()
    loadThreads()
    loadCloseFriends()

    if (openThreadWithUserId && !hasOpenedRef.current) {
      hasOpenedRef.current = true
      openOrCreateThread(openThreadWithUserId)
      clearOpenThreadRequest()
    }
  }, [])

  useEffect(() => {
    if (setActiveConversation) {
      if (activeThread) {
        setActiveConversation({ type: 'dm', id: activeThread.id })
      } else {
        setActiveConversation(null)
      }
    }
  }, [activeThread])

  useEffect(() => {
    let unsub

    pb.collection('users').subscribe('*', (e) => {
      if (e.action !== 'update') return

      setThreads((prev) =>
        prev.map((t) =>
          t.otherUser?.id === e.record.id
            ? { ...t, otherUser: { ...t.otherUser, status: e.record.status, public_key: e.record.public_key } }
            : t
        )
      )

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

  const loadMessages = async (threadId) => {
    try {
      const records = await pb.collection('dm_messages').getFullList({
        filter: `dm_thread="${threadId}"`,
        sort: 'created',
        expand: 'sender',
      })
      setMessages(records)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (!activeThread) return

    loadMessages(activeThread.id)
    checkPendingConsentRequest(activeThread.id)

    let unsub

    pb.collection('dm_messages').subscribe('*', async (e) => {
      if (e.record.dm_thread !== activeThread.id) return
      if (e.action === 'create') {
        const fullRecord = await pb.collection('dm_messages').getOne(e.record.id, {
          expand: 'sender',
        })
        setMessages((prev) => [...prev, fullRecord])
      }
    }).then((fn) => {
      unsub = fn
    })

    return () => {
      if (unsub) unsub()
    }
  }, [activeThread])

  const handleSend = async (e) => {
    e.preventDefault()
    setError('')

    if (!content.trim()) {
      setError('Message cannot be empty')
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
      const encryptedContent = encryptMessage(content, theirPublicKey, myPrivateKey)

      await pb.collection('dm_messages').create({
        dm_thread: activeThread.id,
        sender: uid,
        content: encryptedContent,
      })
      setContent('')
    } catch (err) {
      console.error(err)
      setError('Something went wrong sending the message')
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
    return text
  }

  if (activeThread) {
    return (
      <div>
        <button onClick={() => setActiveThread(null)}>← Back to inbox</button>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {activeThread.otherUser?.avatar ? (
            <img src={pb.files.getURL(activeThread.otherUser, activeThread.otherUser.avatar, { thumb: '32x32' })} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#333' }} />
          )}
          {activeThread.otherUser?.name || 'Unknown'}{' '}
          ({activeThread.otherUser?.status === 'invisible' ? 'offline' : (activeThread.otherUser?.status || 'online')})
        </h1>

        {pendingConsentRequest && (
          <div style={{ border: '1px solid orange', borderRadius: '6px', padding: '12px', marginBottom: '12px' }}>
            <p>
              A moderator has requested to review this ENTIRE conversation as part of investigating a report you filed. Do you consent?
            </p>
            <button onClick={() => handleRespondToConsentRequest(true)} disabled={consentResponding}>
              Approve
            </button>
            {' '}
            <button onClick={() => handleRespondToConsentRequest(false)} disabled={consentResponding}>
              Deny
            </button>
          </div>
        )}

        <div>
          {messages.length === 0 && <p>No messages yet.</p>}
          {messages.map((msg) => (
            <div key={msg.id} style={{ fontSize: 'var(--orbit-text-size, 16px)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              {msg.expand?.sender?.avatar ? (
                <img src={pb.files.getURL(msg.expand.sender, msg.expand.sender.avatar, { thumb: '24x24' })} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#333' }} />
              )}
              <strong>{msg.expand?.sender?.name || 'Unknown'}</strong>: {renderMessageText(msg)}
              {' '}
              <button onClick={() => setReportingId(reportingId === msg.id ? null : msg.id)}>
                Report
              </button>

              {reportingId === msg.id && (
                <div>
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
          ))}
        </div>

        <form onSubmit={handleSend}>
          <input
            type="text"
            placeholder={`Message ${activeThread.otherUser?.name || ''}`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button type="submit" disabled={sending}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>
    )
  }

  const closeThreads = threads.filter((t) => closeFriendIds.includes(t.otherUser?.id))
  const normalThreads = threads.filter((t) => !closeFriendIds.includes(t.otherUser?.id))

  const renderThreadRow = (thread) => (
    <li key={thread.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button onClick={() => setActiveThread(thread)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {thread.otherUser?.avatar ? (
          <img src={pb.files.getURL(thread.otherUser, thread.otherUser.avatar, { thumb: '32x32' })} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#333' }} />
        )}
        {thread.otherUser?.name || 'Unknown'} (@{thread.otherUser?.username}){' '}
        — {thread.otherUser?.status === 'invisible' ? 'offline' : (thread.otherUser?.status || 'online')}
      </button>
      <button onClick={() => toggleCloseFriend(thread.otherUser?.id)}>
        {closeFriendIds.includes(thread.otherUser?.id) ? '★ Remove Close Friend' : '☆ Make Close Friend'}
      </button>
    </li>
  )

  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h1>Direct Messages</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {threads.length === 0 && <p>No conversations yet.</p>}

      {closeThreads.length > 0 && (
        <>
          <h2>Close Friends</h2>
          <ul>{closeThreads.map(renderThreadRow)}</ul>
        </>
      )}

      {normalThreads.length > 0 && (
        <>
          <h2>Normal Friends</h2>
          <ul>{normalThreads.map(renderThreadRow)}</ul>
        </>
      )}
    </div>
  )
}

export default DMs