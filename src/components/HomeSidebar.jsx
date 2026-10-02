import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import UserPanel from './UserPanel'
import { useUnread, getDmUnread, markRead, getDmPrefs, setDmPrefs } from '../unread'
import { useDmThreads } from '../dmStore'
import { useI18n } from '../i18n'
import { SERVER_TAG_MAP, tagLabel, tagMatchesQuery } from '../serverTags'

// A joined-server search matches the name, the category, or any tag (labels
// and aliases). Returns null when nothing matches; otherwise which tag matched
// (so the row can show it) is attached for tag-only matches.
function matchJoinedServer(server, query) {
  const q = query.trim().toLowerCase()
  if (!q) return null
  if (server.name?.toLowerCase().includes(q)) return { tag: null }
  if ((server.category || '').toLowerCase().includes(q)) return { tag: null }
  const tag = (Array.isArray(server.tags) ? server.tags : [])
    .find((id) => SERVER_TAG_MAP[id] && tagMatchesQuery(SERVER_TAG_MAP[id], q))
  return tag ? { tag } : null
}

function HomeSidebar({ page, activeDmThreadId, onOpenFriends, onOpenThread, onOpenSettings, onOpenBilling, onOpenShop, onOpenBookmarks, myServers = [], onOpenServer, pinnedServerIds = [] }) {
  const { t } = useI18n()
  const [serverSearch, setServerSearch] = useState('')
  // Shared, requestKey-safe DM conversation source (see dmStore.js).
  const { threads } = useDmThreads()
  // Subscribe to unread-state changes so DM badges re-render.
  useUnread()

  const serverMatches = serverSearch.trim()
    ? myServers
      .map((server) => ({ server, match: matchJoinedServer(server, serverSearch) }))
      .filter((entry) => entry.match)
    : []

  // Bulk DM management (report §4.38): select mode + archive/close/mute/mark.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedThreadIds, setSelectedThreadIds] = useState([])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [bulkFolder, setBulkFolder] = useState('')

  const toggleSelected = (id) => {
    setSelectedThreadIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const applyToSelected = async (mutate) => {
    const ids = [...selectedThreadIds]
    await Promise.all(ids.map((id) => mutate(id)))
    setSelectedThreadIds([])
    setSelectMode(false)
  }

  const me = pb.authStore.model

  // Private DM folders (report §4.38 "folders/groups"). Loaded here since the
  // home sidebar is the only surface that needs them.
  const [folders, setFolders] = useState([])
  const [folderFilter, setFolderFilter] = useState('all') // 'all' | 'none' | folderId

  useEffect(() => {
    const uid = me?.id
    if (!uid) return
    let cancelled = false
    let unsub
    const load = async () => {
      try {
        const rows = await pb.collection('dm_folders').getFullList({
          filter: `user="${uid}"`,
          sort: 'position,created',
          requestKey: null,
        })
        if (!cancelled) setFolders(rows)
      } catch (err) {
        console.error('Load DM folders error:', err)
      }
    }
    load()
    pb.collection('dm_folders').subscribe('*', (e) => {
      if (e.record.user === uid) load()
    }).then((fn) => {
      if (cancelled) { fn(); return }
      unsub = fn
    }).catch((err) => console.error('DM folders subscribe error:', err))
    return () => { cancelled = true; if (unsub) unsub() }
  }, [me?.id])

  const createFolder = async () => {
    const name = window.prompt('Folder name')
    if (!name || !name.trim()) return
    try {
      const created = await pb.collection('dm_folders').create({
        user: me.id,
        name: name.trim().slice(0, 40),
        position: folders.length,
      }, { requestKey: null })
      setFolders((prev) => [...prev, created])
    } catch (err) {
      console.error('Create DM folder error:', err)
    }
  }

  const deleteFolder = async (folderId) => {
    if (!window.confirm('Delete this folder? Conversations in it will be unfiled, not deleted.')) return
    try {
      await pb.collection('dm_folders').delete(folderId, { requestKey: null })
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      setFolderFilter('all')
    } catch (err) {
      console.error('Delete DM folder error:', err)
    }
  }

  const visibleThreads = threads.filter((t) => {
    const p = getDmPrefs(t.id)
    if (archivedOpen) return p.archived
    if (p.archived || p.closed) return false
    if (folderFilter === 'all') return true
    if (folderFilter === 'none') return !p.folder
    return p.folder === folderFilter
  })

  return (
    <div className="home-sidebar">
      <button
        className={`home-sidebar-item${page === 'friends' ? ' active' : ''}`}
        onClick={onOpenFriends}
      >
        👥 {t('sidebar.friends')}
      </button>

      <button
        className={`home-sidebar-item${page === 'billing' ? ' active' : ''}`}
        onClick={onOpenBilling}
      >
        ⭐ Orbit+
      </button>

      <button
        className={`home-sidebar-item${page === 'shop' ? ' active' : ''}`}
        onClick={onOpenShop}
      >
        🛍️ {t('sidebar.shop')}
        <span className="home-sidebar-badge">NEW</span>
      </button>

      <button
        className={`home-sidebar-item${page === 'bookmarks' ? ' active' : ''}`}
        onClick={onOpenBookmarks}
      >
        🔖 {t('sidebar.bookmarks')}
      </button>

      <div className="home-sidebar-label">Servers</div>

      <input
        type="text"
        className="home-sidebar-search"
        placeholder="Find a server"
        value={serverSearch}
        onChange={(e) => setServerSearch(e.target.value)}
      />

      {serverSearch.trim() && (
        <div className="home-sidebar-threads">
          {serverMatches.length === 0 && (
            <p className="home-sidebar-empty">No servers match.</p>
          )}
          {serverMatches.map(({ server, match }) => (
            <button
              key={server.id}
              className="home-sidebar-item home-sidebar-thread"
              onClick={() => onOpenServer?.(server)}
            >
              {server.icon ? (
                <img
                  src={pb.files.getURL(server, server.icon, { thumb: '32x32' })}
                  alt=""
                  className="home-sidebar-avatar"
                />
              ) : (
                <div className="home-sidebar-avatar home-sidebar-avatar-fallback">
                  {server.name?.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="home-sidebar-thread-name">{server.name}</span>
              {match.tag && <span className="home-sidebar-match-tag">{tagLabel(match.tag)}</span>}
              {pinnedServerIds.includes(server.id) && <span className="home-sidebar-pin">📌</span>}
            </button>
          ))}
        </div>
      )}

      <div className="home-sidebar-label home-sidebar-label-row">
        <span>{t('sidebar.directMessages')}</span>
        {threads.length > 0 && (
          <button
            className="home-sidebar-mini-btn"
            onClick={() => { setSelectMode((v) => !v); setSelectedThreadIds([]) }}
          >
            {selectMode ? 'Cancel' : t('common.select')}
          </button>
        )}
      </div>

      <div className="home-sidebar-folder-chips">
        <button
          className={`home-sidebar-mini-btn${folderFilter === 'all' ? ' active' : ''}`}
          onClick={() => setFolderFilter('all')}
        >
          All
        </button>
        <button
          className={`home-sidebar-mini-btn${folderFilter === 'none' ? ' active' : ''}`}
          onClick={() => setFolderFilter('none')}
        >
          Unfiled
        </button>
        {folders.map((f) => (
          <span key={f.id} className="home-sidebar-folder-chip-wrap">
            <button
              className={`home-sidebar-mini-btn${folderFilter === f.id ? ' active' : ''}`}
              onClick={() => setFolderFilter(f.id)}
            >
              {f.name}
            </button>
            {folderFilter === f.id && (
              <button className="home-sidebar-mini-btn" title="Delete folder" onClick={() => deleteFolder(f.id)}>✕</button>
            )}
          </span>
        ))}
        <button className="home-sidebar-mini-btn" title="New folder" onClick={createFolder}>＋</button>
      </div>

      {selectMode && (
        <div className="home-sidebar-bulk-bar">
          <button className="home-sidebar-mini-btn" disabled={selectedThreadIds.length === 0}
            onClick={() => applyToSelected((id) => setDmPrefs(id, archivedOpen ? { archived: false } : { archived: true, closed: false }))}>
            {archivedOpen ? 'Unarchive' : 'Archive'}
          </button>
          <button className="home-sidebar-mini-btn" disabled={selectedThreadIds.length === 0}
            onClick={() => applyToSelected((id) => setDmPrefs(id, { closed: true, archived: false }))}>
            Close
          </button>
          <button className="home-sidebar-mini-btn" disabled={selectedThreadIds.length === 0}
            onClick={() => applyToSelected((id) => setDmPrefs(id, { muted: true }))}>
            Mute
          </button>
          <button className="home-sidebar-mini-btn" disabled={selectedThreadIds.length === 0}
            onClick={() => applyToSelected((id) => { markRead('dm', id) })}>
            Mark Read
          </button>
          <select
            className="home-sidebar-mini-btn"
            value={bulkFolder}
            disabled={selectedThreadIds.length === 0}
            onChange={(e) => {
              const value = e.target.value
              setBulkFolder(value)
              if (!value) return
              applyToSelected((id) => setDmPrefs(id, { folder: value === '__none' ? '' : value }))
                .then(() => setBulkFolder(''))
            }}
          >
            <option value="">Move to folder…</option>
            <option value="__none">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="home-sidebar-threads">
        {visibleThreads.length === 0 && (
          <p className="home-sidebar-empty">{archivedOpen ? 'No archived conversations.' : 'No conversations yet.'}</p>
        )}
        {visibleThreads.map((thread) => {
          const unread = getDmUnread(thread.id)
          const prefs = getDmPrefs(thread.id)
          return (
            <div key={thread.id} className="home-sidebar-thread-row">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selectedThreadIds.includes(thread.id)}
                  onChange={() => toggleSelected(thread.id)}
                />
              )}
              <button
                className={`home-sidebar-item home-sidebar-thread${page === 'dms' && activeDmThreadId === thread.id ? ' active' : ''}`}
                onClick={() => {
                  if (selectMode) { toggleSelected(thread.id); return }
                  markRead('dm', thread.id)
                  onOpenThread(thread.otherUser.id)
                }}
              >
                {thread.otherUser.avatar ? (
                  <img
                    src={pb.files.getURL(thread.otherUser, thread.otherUser.avatar, { thumb: '32x32' })}
                    alt=""
                    className="home-sidebar-avatar"
                  />
                ) : (
                  <div className="home-sidebar-avatar home-sidebar-avatar-fallback" />
                )}
                <span className="home-sidebar-thread-name">{thread.otherUser.name}</span>
                {prefs.muted && <span className="home-sidebar-pin" title="Muted">🔇</span>}
                {unread && (
                  <span className="home-sidebar-ping" title={`${unread.count} unread`}>
                    {unread.count}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {threads.some((t) => getDmPrefs(t.id).archived) && (
        <button
          className="home-sidebar-mini-btn home-sidebar-archived-toggle"
          onClick={() => { setArchivedOpen((v) => !v); setSelectedThreadIds([]) }}
        >
          {archivedOpen ? '← Back to Inbox' : 'Show archived'}
        </button>
      )}

      <UserPanel onOpenSettings={onOpenSettings} />
    </div>
  )
}

export default HomeSidebar