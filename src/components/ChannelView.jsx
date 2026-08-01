import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import { hasChannelPermission } from '../permissions'
import MembersSidebar from './MembersSidebar'

function ChannelView({ channel, server, onBack, setActiveConversation, members, ownerName, ownerStatus, ownerAvatarUrl }) {
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [reportingId, setReportingId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportStatus, setReportStatus] = useState('')

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
    if (setActiveConversation) {
      setActiveConversation({ type: 'channel', id: channel.id })
    }
    return () => {
      if (setActiveConversation) setActiveConversation(null)
    }
  }, [channel.id])

  useEffect(() => {
    loadMessages()

    let unsub

    pb.collection('messages').subscribe('*', async (e) => {
      if (e.record.channel !== channel.id) return

      if (e.action === 'create') {
        const fullRecord = await pb.collection('messages').getOne(e.record.id, {
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
  }, [channel.id])

  const handleSend = async (e) => {
    e.preventDefault()
    setError('')

    if (!content.trim()) {
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
    <div style={{ display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button onClick={onBack}>← Back to server</button>
        <h1>#{channel.name}</h1>

        <div>
          {messages.length === 0 && <p>No messages yet.</p>}
          {messages.map((msg) => (
            <div key={msg.id} style={{ fontSize: 'var(--orbit-text-size, 16px)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              {msg.expand?.sender?.avatar ? (
                <img src={pb.files.getURL(msg.expand.sender, msg.expand.sender.avatar, { thumb: '24x24' })} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#333' }} />
              )}
              <strong>{msg.expand?.sender?.name || 'Unknown'}</strong>: {msg.content}
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

      {members && (
        <MembersSidebar
          members={members}
          ownerName={ownerName}
          ownerStatus={ownerStatus}
          ownerAvatarUrl={ownerAvatarUrl}
        />
      )}
    </div>
  )
}

export default ChannelView