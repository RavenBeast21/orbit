import { useMemo, useState, useEffect } from 'react'
import pb from '../pocketbase'
import { logPbError } from '../pbErrors'
import { SERVER_TAG_MAP, tagLabel, tagMatchesQuery } from '../serverTags'

const CATEGORIES = ['All', 'Gaming', 'Music', 'Education', 'Technology', 'Art & Design', 'Community', 'Other']

function serverTagIds(server) {
  return Array.isArray(server.tags) ? server.tags.filter((id) => SERVER_TAG_MAP[id]) : []
}

function serverMatchesSearch(server, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if ((server.name || '').toLowerCase().includes(q)) return true
  if ((server.description || '').toLowerCase().includes(q)) return true
  if ((server.category || '').toLowerCase().includes(q)) return true
  return serverTagIds(server).some((id) => tagMatchesQuery(SERVER_TAG_MAP[id], query))
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function Discovery({ onBack, onJoined }) {
  const [servers, setServers] = useState([])
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [showAllTags, setShowAllTags] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [joiningId, setJoiningId] = useState(null)

  const uid = pb.authStore.model.id

  const loadServers = async () => {
    setLoading(true)
    setError('')
    try {
      const records = await pb.collection('servers').getFullList({
        filter: `type="community" && discovery_visible=true`,
      })
      setServers(records)
    } catch (err) {
      logPbError('Load discovery servers error:', err)
      setError('Failed to load servers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadServers()
  }, [])

  // Tag facets come from what is actually listed, so a filter never leads to
  // a guaranteed-empty result.
  const tagFacets = useMemo(() => {
    const counts = new Map()
    servers.forEach((server) => {
      serverTagIds(server).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1))
    })
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || tagLabel(a[0]).localeCompare(tagLabel(b[0])))
      .map(([id, count]) => ({ id, count }))
  }, [servers])

  const hasFilters = category !== 'All' || !!search.trim() || selectedTags.length > 0

  const filteredServers = useMemo(() => {
    const matches = servers.filter((server) => {
      if (category !== 'All' && server.category !== category) return false
      if (!serverMatchesSearch(server, search)) return false
      if (selectedTags.length > 0) {
        const ids = serverTagIds(server)
        if (!selectedTags.some((tag) => ids.includes(tag))) return false
      }
      return true
    })
    if (selectedTags.length < 2) return matches
    // Most tag matches first, keeping the original order for ties.
    return [...matches].sort((a, b) => {
      const ac = serverTagIds(a).filter((id) => selectedTags.includes(id)).length
      const bc = serverTagIds(b).filter((id) => selectedTags.includes(id)).length
      return bc - ac
    })
  }, [servers, category, search, selectedTags])

  const handleJoin = async (server) => {
    setError('')
    setJoiningId(server.id)

    try {
      if (server.owner === uid) {
        if (onJoined) onJoined(server)
        return
      }

      const existingBans = await pb.collection('bans').getFullList({
        filter: `user="${uid}" && server="${server.id}"`,
      })
      if (existingBans.length > 0) {
        setError(`You're banned from ${server.name}`)
        return
      }

      const existingMembership = await pb.collection('members').getFullList({
        filter: `user="${uid}" && server="${server.id}"`,
      })
      if (existingMembership.length > 0) {
        if (onJoined) onJoined(server)
        return
      }

      await pb.collection('members').create({
        user: uid,
        server: server.id,
      })

      if (onJoined) onJoined(server)
    } catch (err) {
      console.error('Join error:', err)
      setError(err.message || 'Something went wrong joining this server')
    } finally {
      setJoiningId(null)
    }
  }

  const toggleTag = (id) => {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const clearFilters = () => {
    setCategory('All')
    setSearch('')
    setSelectedTags([])
  }

  const visibleFacets = showAllTags ? tagFacets : tagFacets.slice(0, 10)
  // Keep selected facets visible even when they fall outside the top 10.
  const facetIds = new Set(visibleFacets.map((f) => f.id))
  const orderedFacets = [
    ...tagFacets.filter((f) => selectedTags.includes(f.id) && !facetIds.has(f.id)),
    ...visibleFacets,
  ]

  return (
    <div className="panel discovery">
      <h1>Discover Servers</h1>

      <div className="discovery-search">
        <div className="discovery-search-field">
          <IconSearch />
          <input
            type="text"
            value={search}
            placeholder="Search by name, description or tag"
            aria-label="Search servers"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
          />
          {search && (
            <button type="button" className="discovery-search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
              <IconX />
            </button>
          )}
        </div>
      </div>

      <div className="discovery-cats" role="group" aria-label="Categories">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className="discovery-cat"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {tagFacets.length > 0 && (
        <div className="discovery-tagbar">
          {orderedFacets.map((facet) => (
            <button
              key={facet.id}
              type="button"
              className="tag-chip"
              aria-pressed={selectedTags.includes(facet.id)}
              onClick={() => toggleTag(facet.id)}
            >
              <span className="tag-chip-label">{tagLabel(facet.id)}</span>
            </button>
          ))}
          {tagFacets.length > 10 && (
            <button
              type="button"
              className="tag-chip tag-chip--ghost"
              onClick={() => setShowAllTags((v) => !v)}
            >
              {showAllTags ? 'Fewer tags' : `All tags (${tagFacets.length})`}
            </button>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && (
        <div className="discovery-results-bar">
          <span>{filteredServers.length} server{filteredServers.length === 1 ? '' : 's'}</span>
          {hasFilters && (
            <button type="button" className="discovery-clear-btn" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      )}

      {loading && (
        <div className="discovery-list">
          {[0, 1, 2].map((i) => (
            <div className="discovery-card discovery-card--skeleton" key={i} aria-hidden="true">
              <span className="discovery-skeleton-avatar" />
              <div className="discovery-skeleton-lines">
                <span className="discovery-skeleton-bar discovery-skeleton-bar--long" />
                <span className="discovery-skeleton-bar discovery-skeleton-bar--short" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filteredServers.length === 0 && (
        <div className="friends-empty">
          <div className="friends-empty-title">
            {servers.length === 0 ? 'No servers to discover yet' : 'No servers match'}
          </div>
          <p className="friends-empty-body">
            {servers.length === 0
              ? 'Check back later — new communities will show up here.'
              : 'Try removing a filter or searching for something else.'}
          </p>
          {hasFilters && (
            <div className="friends-empty-action">
              <button type="button" className="friends-action" onClick={clearFilters}>Clear filters</button>
            </div>
          )}
        </div>
      )}

      <div className="discovery-list">
        {filteredServers.map((server) => {
          const tags = serverTagIds(server)
          const shown = tags.slice(0, 3)
          const hiddenCount = tags.length - shown.length
          return (
            <div key={server.id} className="discovery-card">
              {server.icon ? (
                <img
                  src={pb.files.getURL(server, server.icon, { thumb: '48x48' })}
                  alt=""
                  className="discovery-card-icon"
                />
              ) : (
                <div className="discovery-card-icon discovery-card-icon--fallback" />
              )}

              <div className="discovery-card-body">
                <div className="discovery-card-head">
                  <strong className="discovery-card-name">{server.name}</strong>
                  {server.category && <span className="discovery-card-category">{server.category}</span>}
                </div>
                {server.description && <p className="discovery-card-desc">{server.description}</p>}
                {tags.length > 0 && (
                  <div className="discovery-card-tags">
                    {shown.map((id) => (
                      <span
                        key={id}
                        className={`tag-chip tag-chip--static${selectedTags.includes(id) ? ' tag-chip--match' : ''}`}
                      >
                        <span className="tag-chip-label">{tagLabel(id)}</span>
                      </span>
                    ))}
                    {hiddenCount > 0 && (
                      <span
                        className="tag-chip tag-chip--static"
                        title={tags.slice(3).map(tagLabel).join(', ')}
                      >
                        +{hiddenCount}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <button className="btn-primary discovery-join-btn" onClick={() => handleJoin(server)} disabled={joiningId === server.id}>
                {joiningId === server.id ? 'Joining...' : 'Join'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Discovery
