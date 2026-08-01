import { useState, useEffect } from 'react'
import pb from '../pocketbase'

const REPORTS_KEY_SERVER_URL = 'http://localhost:3001'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'dm_message', label: 'DMs' },
  { key: 'server', label: 'Servers' },
  { key: 'user', label: 'Accounts' },
  { key: 'message', label: 'Messages' },
]

function ReportsQueue({ onBack }) {
  const [reports, setReports] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [details, setDetails] = useState({}) // reportId -> loaded context (server/user/message/dm info)
  const [dmDecrypting, setDmDecrypting] = useState(null) // reportId currently decrypting
  const [dmDecrypted, setDmDecrypted] = useState({}) // reportId -> decrypted result
  const [resolvingId, setResolvingId] = useState(null)
  const [claimingId, setClaimingId] = useState(null)
  const [addingSupportFor, setAddingSupportFor] = useState(null)
  const [supportUsername, setSupportUsername] = useState('')
  const [supportError, setSupportError] = useState('')
  const [consents, setConsents] = useState({}) // reportId -> consent record or null
  const [requestingConsent, setRequestingConsent] = useState(null)
  const [fullThread, setFullThread] = useState({}) // reportId -> { messages }
  const [loadingThread, setLoadingThread] = useState(null)

  const uid = pb.authStore.model.id

  const loadReports = async () => {
    setLoading(true)
    setError('')
    try {
      const records = await pb.collection('reports').getFullList({
        sort: '-created',
      })
      setReports(records)
      loadDetailsFor(records)
      loadConsentsFor(records)
    } catch (err) {
      console.error('Load reports error:', err)
      setError('Failed to load reports — you may not have permission to view this page')
    } finally {
      setLoading(false)
    }
  }

  const loadDetailsFor = async (records) => {
    const results = {}

    await Promise.all(
      records.map(async (report) => {
        try {
          if (report.target_type === 'server') {
            const server = await pb.collection('servers').getOne(report.target_id)
            results[report.id] = { server }
          } else if (report.target_type === 'user') {
            const user = await pb.collection('users').getOne(report.target_id)
            results[report.id] = { user }
          } else if (report.target_type === 'message') {
            const message = await pb.collection('messages').getOne(report.target_id, { expand: 'sender' })
            const channel = await pb.collection('channels').getOne(message.channel)
            const server = await pb.collection('servers').getOne(channel.server)
            results[report.id] = { message, channel, server }
          } else if (report.target_type === 'dm_message') {
            const message = await pb.collection('dm_messages').getOne(report.target_id, { expand: 'sender' })
            results[report.id] = { dmMessage: message }
          }
        } catch (err) {
          results[report.id] = { loadError: true }
        }
      })
    )

    setDetails((prev) => ({ ...prev, ...results }))
  }

  const loadConsentsFor = async (records) => {
    const dmReports = records.filter((r) => r.target_type === 'dm_message')
    const results = {}

    await Promise.all(
      dmReports.map(async (report) => {
        try {
          const record = await pb.collection('dm_search_consents').getFirstListItem(
            `report="${report.id}"`
          )
          results[report.id] = record
        } catch (err) {
          results[report.id] = null
        }
      })
    )

    setConsents((prev) => ({ ...prev, ...results }))
  }

  useEffect(() => {
    loadReports()
  }, [])

  const handleClaimReport = async (report) => {
    setClaimingId(report.id)
    try {
      const updated = await pb.collection('reports').update(report.id, {
        claimed_by: uid,
      })
      setReports((prev) => prev.map((r) => (r.id === report.id ? updated : r)))
    } catch (err) {
      console.error('Claim report error:', err)
      setError('Failed to claim this report')
    } finally {
      setClaimingId(null)
    }
  }

  const handleAddSupportDev = async (report) => {
    setSupportError('')
    if (!supportUsername.trim()) {
      setSupportError('Enter a username')
      return
    }

    try {
      const supportUser = await pb.collection('users').getFirstListItem(
        `username="${supportUsername.trim()}"`
      )

      if (!supportUser.is_developer) {
        setSupportError('That account is not a dev account')
        return
      }

      const consent = consents[report.id]
      if (!consent) {
        setSupportError('No consent record exists for this report yet')
        return
      }

      const existingSupport = consent.support_devs || []
      if (existingSupport.includes(supportUser.id)) {
        setSupportError('That dev already has access')
        return
      }

      const updated = await pb.collection('dm_search_consents').update(consent.id, {
        support_devs: [...existingSupport, supportUser.id],
      })

      setConsents((prev) => ({ ...prev, [report.id]: updated }))
      setSupportUsername('')
      setAddingSupportFor(null)
    } catch (err) {
      console.error('Add support dev error:', err)
      setSupportError('Could not find a dev account with that username')
    }
  }

  const handleDecryptDm = async (report) => {
    setDmDecrypting(report.id)
    try {
      const response = await fetch(`${REPORTS_KEY_SERVER_URL}/reports/decrypt-dm-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pb.authStore.token, messageId: report.target_id, reportId: report.id }),
      })

      const data = await response.json()

      if (!response.ok) {
        setDmDecrypted((prev) => ({ ...prev, [report.id]: { error: data.error || 'Failed to decrypt' } }))
        return
      }

      setDmDecrypted((prev) => ({ ...prev, [report.id]: data }))
    } catch (err) {
      console.error('Decrypt DM error:', err)
      setDmDecrypted((prev) => ({ ...prev, [report.id]: { error: 'Network error contacting the key server' } }))
    } finally {
      setDmDecrypting(null)
    }
  }

  const handleRequestConsent = async (report) => {
    if (report.claimed_by !== uid) {
      setError('You must claim this report before requesting consent')
      return
    }

    setRequestingConsent(report.id)
    try {
      const detail = details[report.id]
      const threadId = detail?.dmMessage?.dm_thread

      if (!threadId) {
        setError('Could not determine which conversation this report belongs to')
        return
      }

      const record = await pb.collection('dm_search_consents').create({
        report: report.id,
        thread: threadId,
        target_user: report.reported_by,
        requested_by: uid,
        status: 'pending',
      })

      setConsents((prev) => ({ ...prev, [report.id]: record }))
    } catch (err) {
      console.error('Request consent error:', err)
      setError('Failed to request consent for this report')
    } finally {
      setRequestingConsent(null)
    }
  }

  const handleViewFullThread = async (report) => {
    setLoadingThread(report.id)
    try {
      const response = await fetch(`${REPORTS_KEY_SERVER_URL}/reports/decrypt-dm-thread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pb.authStore.token, reportId: report.id }),
      })

      const data = await response.json()

      if (!response.ok) {
        setFullThread((prev) => ({ ...prev, [report.id]: { error: data.error || 'Failed to load conversation' } }))
        return
      }

      setFullThread((prev) => ({ ...prev, [report.id]: data }))
    } catch (err) {
      console.error('View full thread error:', err)
      setFullThread((prev) => ({ ...prev, [report.id]: { error: 'Network error contacting the key server' } }))
    } finally {
      setLoadingThread(null)
    }
  }

  const handleResolve = async (reportId) => {
    setResolvingId(reportId)
    try {
      const consent = consents[reportId]
      if (consent) {
        try {
          await pb.collection('dm_search_consents').delete(consent.id)
        } catch (err) {
          console.error('Failed to clean up consent record:', err)
        }
      }

      await pb.collection('reports').delete(reportId)
      setReports((prev) => prev.filter((r) => r.id !== reportId))
    } catch (err) {
      console.error('Resolve report error:', err)
      setError('Failed to dismiss that report')
    } finally {
      setResolvingId(null)
    }
  }

  const filteredReports = filter === 'all' ? reports : reports.filter((r) => r.target_type === filter)

  const renderReportBody = (report) => {
    const detail = details[report.id]

    if (!detail) {
      return <p style={{ color: 'gray' }}>Loading details...</p>
    }

    if (detail.loadError) {
      return <p style={{ color: 'gray' }}>The reported content may have already been removed.</p>
    }

    if (report.target_type === 'server' && detail.server) {
      return (
        <div>
          <p><strong>Server:</strong> {detail.server.name} (ID: {detail.server.id})</p>
        </div>
      )
    }

    if (report.target_type === 'user' && detail.user) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {detail.user.avatar ? (
            <img src={pb.files.getURL(detail.user, detail.user.avatar, { thumb: '32x32' })} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#333' }} />
          )}
          <div>
            <div>{detail.user.name} (@{detail.user.username})</div>
            {detail.user.bio && <div style={{ color: 'gray', fontSize: '0.9em' }}>{detail.user.bio}</div>}
          </div>
        </div>
      )
    }

    if (report.target_type === 'message' && detail.message) {
      return (
        <div>
          <p>
            <strong>{detail.message.expand?.sender?.name || 'Unknown'}</strong> in <strong>{detail.server?.name}</strong> #{detail.channel?.name}
          </p>
          <p style={{ color: 'lightgray' }}>{detail.message.content}</p>
          <p style={{ color: 'gray', fontSize: '0.85em' }}>{new Date(detail.message.created).toLocaleString()}</p>
        </div>
      )
    }

    if (report.target_type === 'dm_message' && detail.dmMessage) {
      const decrypted = dmDecrypted[report.id]
      const isDecrypting = dmDecrypting === report.id
      const consent = consents[report.id]
      const thread = fullThread[report.id]
      const isLoadingThread = loadingThread === report.id
      const supportDevs = consent?.support_devs || []
      const isAuthorized = report.claimed_by === uid || supportDevs.includes(uid)

      return (
        <div>
          <p>
            <strong>{detail.dmMessage.expand?.sender?.name || 'Unknown'}</strong>
            {' '}— {new Date(detail.dmMessage.created).toLocaleString()}
          </p>

          {!report.claimed_by && (
            <button onClick={() => handleClaimReport(report)} disabled={claimingId === report.id}>
              {claimingId === report.id ? 'Claiming...' : 'Claim This Report'}
            </button>
          )}

          {report.claimed_by && !isAuthorized && (
            <p style={{ color: 'gray' }}>
              This report has been claimed by another dev. Ask them to add you via Request Support to view its content.
            </p>
          )}

          {isAuthorized && (
            <>
              {!decrypted && (
                <button onClick={() => handleDecryptDm(report)} disabled={isDecrypting}>
                  {isDecrypting ? 'Decrypting...' : 'Decrypt & View This Message'}
                </button>
              )}

              {decrypted && decrypted.error && (
                <p style={{ color: 'red' }}>{decrypted.error}</p>
              )}

              {decrypted && !decrypted.error && (
                <div>
                  <p style={{ color: 'lightgray' }}>{decrypted.text}</p>
                  <p style={{ color: 'gray', fontSize: '0.85em' }}>
                    {decrypted.senderName} → {decrypted.otherParticipantName}
                  </p>
                </div>
              )}

              <hr style={{ borderColor: '#333', margin: '12px 0' }} />

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.8em', color: 'gray', textTransform: 'uppercase' }}>
                    Full conversation access
                  </span>
                  {report.claimed_by === uid && (
                    <button onClick={() => { setAddingSupportFor(report.id); setSupportError('') }}>
                      + Request Support
                    </button>
                  )}
                </div>

                {addingSupportFor === report.id && (
                  <div style={{ marginBottom: '8px' }}>
                    <input
                      type="text"
                      placeholder="Dev's username"
                      value={supportUsername}
                      onChange={(e) => setSupportUsername(e.target.value)}
                    />
                    <button onClick={() => handleAddSupportDev(report)}>Add</button>
                    <button onClick={() => { setAddingSupportFor(null); setSupportUsername('') }}>Cancel</button>
                    {supportError && <p style={{ color: 'red', fontSize: '0.85em' }}>{supportError}</p>}
                  </div>
                )}

                {supportDevs.length > 0 && (
                  <p style={{ fontSize: '0.85em', color: 'gray' }}>
                    Also has access: {supportDevs.length} dev(s)
                  </p>
                )}

                {!consent && (
                  <button onClick={() => handleRequestConsent(report)} disabled={requestingConsent === report.id}>
                    {requestingConsent === report.id ? 'Requesting...' : 'Request Consent to Review Full Conversation'}
                  </button>
                )}

                {consent && consent.status === 'pending' && (
                  <p style={{ color: 'orange' }}>Consent requested — awaiting the reporter's response.</p>
                )}

                {consent && consent.status === 'denied' && (
                  <p style={{ color: 'red' }}>Consent was denied for this report.</p>
                )}

                {consent && consent.status === 'granted' && !thread && (
                  <button onClick={() => handleViewFullThread(report)} disabled={isLoadingThread}>
                    {isLoadingThread ? 'Loading...' : 'View Full Conversation'}
                  </button>
                )}

                {thread && thread.error && (
                  <p style={{ color: 'red' }}>{thread.error}</p>
                )}

                {thread && thread.messages && (
                  <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #333', borderRadius: '4px', padding: '8px', marginTop: '8px' }}>
                    {thread.messages.map((m) => (
                      <p key={m.id} style={{ margin: '4px 0' }}>
                        <strong>{m.senderName}</strong>
                        {' '}<span style={{ color: 'gray', fontSize: '0.8em' }}>{new Date(m.created).toLocaleString()}</span>
                        <br />
                        {m.text}
                      </p>
                    ))}
              </div>
            )}
              </div>
            </>
          )}
        </div>
      )
    }

    return <p style={{ color: 'gray' }}>No further details available.</p>
  }

  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h1>Reports</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              backgroundColor: filter === f.key ? '#333' : 'transparent',
              border: '1px solid #333',
              borderRadius: '4px',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p>Loading reports...</p>}

      {!loading && filteredReports.length === 0 && <p>No reports here.</p>}

      {filteredReports.map((report) => (
        <div key={report.id} style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.8em', color: 'gray', textTransform: 'uppercase' }}>
                {FILTERS.find((f) => f.key === report.target_type)?.label || report.target_type}
              </span>
              <p><strong>Reason:</strong> {report.reason}</p>
            </div>
            <button
              onClick={() => handleResolve(report.id)}
              disabled={resolvingId === report.id}
              style={{ color: 'lightgreen' }}
            >
              {resolvingId === report.id ? 'Dismissing...' : 'Dismiss & Delete'}
            </button>
          </div>

          {renderReportBody(report)}
        </div>
      ))}
    </div>
  )
}

export default ReportsQueue