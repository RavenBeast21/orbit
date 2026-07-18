// DMs.jsx
import { useState, useEffect } from 'react'
import pb from '../pocketbase'

function DMs({ onBack, openThreadWithUserId, clearOpenThreadRequest }) {
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

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

  const openOrCreateThread = async (targetUserId) => {
    setError('')

    try {
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

  useEffect(() => {
    loadThreads()

    if (openThreadWithUserId) {
      openOrCreateThread(openThreadWithUserId)
      clearOpenThreadRequest()
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

    pb.collection('dm_messages').subscribe('*', async (e) => {
      if (e.record.dm_thread !== activeThread.id) return
      if (e.action === 'create') {
        const fullRecord = await pb.collection('dm_messages').getOne(e.record.id, {
          expand: 'sender',
        })
        setMessages((prev) => [...prev, fullRecord])

        const isOwnMessage = e.record.sender === pb.authStore.model.id
        if (!isOwnMessage && pb.authStore.model.notif_message_sound) {
          const audio = new Audio('/notification.mp3')
          audio.play().catch((err) => console.error('Notification sound error:', err))
        }
      }
    })

    return () => {
      pb.collection('dm_messages').unsubscribe('*')
    }
  }, [activeThread])

  const handleSend = async (e) => {
    e.preventDefault()
    setError('')

    if (!content.trim()) {
      setError('Message cannot be empty')
      return
    }

    setSending(true)

    try {
      await pb.collection('dm_messages').create({
        dm_thread: activeThread.id,
        sender: uid,
        content,
      })
      setContent('')
    } catch (err) {
      console.error(err)
      setError('Something went wrong sending the message')
    } finally {
      setSending(false)
    }
  }

  if (activeThread) {
    return (
      <div>
        <button onClick={() => setActiveThread(null)}>← Back to inbox</button>
        <h1>{activeThread.otherUser?.name || 'Unknown'}</h1>

        <div>
          {messages.length === 0 && <p>No messages yet.</p>}
          {messages.map((msg) => (
            <div key={msg.id} style={{ fontSize: 'var(--orbit-text-size, 16px)' }}>
              <strong>{msg.expand?.sender?.name || 'Unknown'}</strong>: {msg.content}
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

  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h1>Direct Messages</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {threads.length === 0 && <p>No conversations yet.</p>}
      <ul>
        {threads.map((thread) => (
          <li key={thread.id}>
            <button onClick={() => setActiveThread(thread)}>
              {thread.otherUser?.name || 'Unknown'} (@{thread.otherUser?.username})
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default DMs