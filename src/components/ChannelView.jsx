// ChannelView.jsx
import { useState, useEffect } from 'react'
import pb from '../pocketbase'

function ChannelView({ channel, onBack }) {
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const loadMessages = async () => {
    try {
      const records = await pb.collection('messages').getFullList({
        filter: `channel="${channel.id}"`,
        sort: 'created',
        expand: 'sender',
      })
      setMessages(records)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadMessages()

    pb.collection('messages').subscribe('*', async (e) => {
      if (e.record.channel !== channel.id) return

      if (e.action === 'create') {
        const fullRecord = await pb.collection('messages').getOne(e.record.id, {
          expand: 'sender',
        })
        setMessages((prev) => [...prev, fullRecord])
      }
    })

    return () => {
      pb.collection('messages').unsubscribe('*')
    }
  }, [channel.id])

  const handleSend = async (e) => {
    e.preventDefault()
    setError('')

    if (!content.trim()) {
      setError('Message cannot be empty')
      return
    }

    setSending(true)

    try {
      await pb.collection('messages').create({
        content,
        sender: pb.authStore.model.id,
        channel: channel.id,
      })

      setContent('')
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong sending the message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <button onClick={onBack}>← Back to server</button>
      <h1>#{channel.name}</h1>

      <div>
        {messages.length === 0 && <p>No messages yet.</p>}
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.expand?.sender?.name || 'Unknown'}</strong>: {msg.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSend}>
        <input
          type="text"
          placeholder={`Message #${channel.name}`}
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

export default ChannelView