import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import { formatDateTime } from '../formatting'

// Personal bookmarks panel (report §4.23). Bookmarks are private — the
// collection only ever returns rows where user = the logged-in user — and
// they hold a snapshot of the message so they still read correctly if the
// original is later deleted. Supports tags, optional reminders (only fire
// while a client is open), and jumping back to the source message.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Bookmarks({ onBack, onJump }) {
  const [bookmarks, setBookmarks] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const [editingId, setEditingId] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [editingTagId, setEditingTagId] = useState(null)
  const [tagDraft, setTagDraft] = useState('')

  const uid = pb.authStore.model?.id

  // Fetch inside the effect (not via a helper called synchronously) so no
  // state is set during the effect body itself — only from the promise.
  useEffect(() => {
    let cancelled = false
    pb.collection('bookmarks').getFullList({
      filter: `user="${uid}"`,
      sort: '-created',
      requestKey: null,
    }).then((rows) => {
      if (!cancelled) setBookmarks(rows)
    }).catch((err) => {
      console.error('Load bookmarks error:', err)
    }).finally(() => {
      if (!cancelled) setLoaded(true)
    })
    return () => { cancelled = true }
  }, [uid])

  const loading = !loaded

  const handleDelete = async (id) => {
    try {
      await pb.collection('bookmarks').delete(id)
      setBookmarks((prev) => prev.filter((b) => b.id !== id))
    } catch (err) {
      console.error('Delete bookmark error:', err)
    }
  }

  const startEditing = (b) => {
    setEditingId(b.id)
    setNoteDraft(b.note || '')
  }

  const saveNote = async (id) => {
    try {
      const updated = await pb.collection('bookmarks').update(id, { note: noteDraft })
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)))
    } catch (err) {
      console.error('Save bookmark note error:', err)
    } finally {
      setEditingId(null)
    }
  }

  const startEditingTag = (b) => {
    setEditingTagId(b.id)
    setTagDraft(b.tag || '')
  }

  const saveTag = async (id) => {
    try {
      const updated = await pb.collection('bookmarks').update(id, { tag: tagDraft.trim().slice(0, 50) })
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)))
    } catch (err) {
      console.error('Save bookmark tag error:', err)
    } finally {
      setEditingTagId(null)
    }
  }

  const setReminder = async (id, value) => {
    try {
      const iso = value ? new Date(value).toISOString() : ''
      const updated = await pb.collection('bookmarks').update(id, { remind_at: iso || '', reminded: false })
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)))
    } catch (err) {
      console.error('Set bookmark reminder error:', err)
    }
  }

  const tags = [...new Set(bookmarks.map((b) => b.tag).filter(Boolean))]

  const query = search.trim().toLowerCase()
  const filtered = bookmarks.filter((b) => {
    if (tagFilter !== 'all' && (b.tag || '') !== (tagFilter === '__untagged' ? '' : tagFilter)) return false
    if (!query) return true
    return [b.content, b.author_name, b.source_label, b.note, b.tag]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(query))
  })

  const canJump = (b) => !!(b.channel || b.thread)

  return (
    <div className="panel">
      <h1>Bookmarks</h1>
      <p style={{ color: 'gray' }}>
        Private to you. Save any message to read later — no server permissions needed.
      </p>

      <div style={{ display: 'flex', gap: '8px', margin: '12px 0', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search bookmarks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="all">All tags</option>
          <option value="__untagged">Untagged</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading && <p style={{ color: 'var(--text)' }}>Loading...</p>}
      {!loading && filtered.length === 0 && (
        <p style={{ color: 'var(--text)' }}>
          {bookmarks.length === 0 ? 'No bookmarks yet. Use the 🔖 button on a message to save one.' : 'No bookmarks match your filters.'}
        </p>
      )}

      <ul className="list-reset">
        {filtered.map((b) => (
          <li key={b.id} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px', marginBottom: '8px' }}>
            <div style={{ color: 'gray', fontSize: '0.85em', marginBottom: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span>{b.author_name || 'Unknown'}{b.source_label ? ` · ${b.source_label}` : ''} · {formatDateTime(b.created)}</span>
              {b.tag && <span style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: '999px', padding: '1px 8px' }}>{b.tag}</span>}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{b.content || <em style={{ color: 'gray' }}>(message had no text content)</em>}</div>

            {b.remind_at && (
              <div style={{ marginTop: '6px', color: b.reminded ? 'gray' : 'var(--warning)', fontSize: '0.85em' }}>
                ⏰ Reminder {b.reminded ? 'sent' : 'set for'} {formatDateTime(b.remind_at)}
              </div>
            )}

            {editingId === b.id ? (
              <div style={{ marginTop: '8px' }}>
                <input
                  type="text"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add a note"
                  style={{ width: '70%' }}
                />
                <button className="btn-primary" style={{ marginLeft: '6px' }} onClick={() => saveNote(b.id)}>Save</button>
                <button style={{ marginLeft: '6px' }} onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            ) : editingTagId === b.id ? (
              <div style={{ marginTop: '8px' }}>
                <input
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Tag / folder name"
                  maxLength={50}
                  style={{ width: '50%' }}
                />
                <button className="btn-primary" style={{ marginLeft: '6px' }} onClick={() => saveTag(b.id)}>Save</button>
                <button style={{ marginLeft: '6px' }} onClick={() => setEditingTagId(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {b.note && <span style={{ color: 'var(--text)', fontStyle: 'italic' }}>Note: {b.note}</span>}
                <button className="home-sidebar-mini-btn" onClick={() => startEditing(b)}>{b.note ? 'Edit note' : 'Add note'}</button>
                <button className="home-sidebar-mini-btn" onClick={() => startEditingTag(b)}>{b.tag ? 'Edit tag' : 'Add tag'}</button>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'gray', fontSize: '0.85em' }}>
                  Remind me
                  <input
                    type="datetime-local"
                    value={toLocalInput(b.remind_at)}
                    onChange={(e) => setReminder(b.id, e.target.value)}
                  />
                </label>

                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '6px' }}>
                  {canJump(b) && (
                    <button className="home-sidebar-mini-btn" title="Open the source message" onClick={() => onJump?.(b)}>↗ Jump</button>
                  )}
                  <button className="home-sidebar-mini-btn" onClick={() => handleDelete(b.id)}>Delete</button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <button onClick={onBack}>← Back</button>
    </div>
  )
}

export default Bookmarks
