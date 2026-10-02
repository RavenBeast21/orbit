import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import { hasPermission } from '../permissions'

// Targeted server invitation, opened from "Invite to Server" in the user
// context menu / full profile modal. Creates an invites record with a
// `target_user`, which the named recipient can accept or decline from
// Friends > Server Invites. Permission (owner or manage_invites) is checked
// here for UX, and authoritatively in pb_hooks/invites.pb.js.
function InviteToServerModal({ serverId, targetUserId, onClose }) {
  const myUid = pb.authStore.model?.id
  const [server, setServer] = useState(null)
  const [targetUser, setTargetUser] = useState(null)
  const [canInvite, setCanInvite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  useEffect(() => {
    if (!serverId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const serverRecord = await pb.collection('servers').getOne(serverId)
        if (cancelled) return
        setServer(serverRecord)

        const allowed = await hasPermission(myUid, serverRecord, 'manage_invites')
        if (!cancelled) setCanInvite(allowed)

        if (targetUserId) {
          const target = await pb.collection('users').getOne(targetUserId)
          if (!cancelled) setTargetUser(target)
        }
      } catch (err) {
        console.error('Load invite context error:', err)
        if (!cancelled) setError('Could not load server information')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [serverId, targetUserId, myUid])

  const handleSend = async () => {
    setError('')
    setSuccess('')
    setSending(true)
    try {
      const created = await pb.collection('invites').create({
        server: serverId,
        created_by: myUid,
        uses: 0,
        target_user: targetUserId || null,
      })
      setInviteCode(created.code)
      setSuccess(`Invitation sent to ${targetUser?.name || 'that user'}.`)
    } catch (err) {
      console.error('Create targeted invite error:', err)
      setError(err?.message || 'Could not send the invitation')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>✕</button>
        <h2>Invite to {server?.name || 'Server'}</h2>

        {loading && <p style={{ color: 'var(--text)' }}>Loading...</p>}

        {!loading && !canInvite && (
          <p style={{ color: 'var(--danger)' }}>
            You don't have permission to invite people to this server.
          </p>
        )}

        {!loading && canInvite && (
          <>
            <p style={{ color: 'var(--text)' }}>
              {targetUser
                ? <>Send <strong>{targetUser.name}</strong> an invitation to join this server.</>
                : 'Create an invite link for this server.'}
            </p>

            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            {success && (
              <>
                <p style={{ color: 'var(--teal)' }}>{success}</p>
                {inviteCode && (
                  <p>
                    Invite code: <strong>{inviteCode}</strong>
                  </p>
                )}
              </>
            )}

            {!success && (
              <button className="btn-primary" onClick={handleSend} disabled={sending}>
                {sending ? 'Sending...' : 'Send Invitation'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default InviteToServerModal
