// serverTags.js
//
// Curated server tags (Batch 1). Servers store only stable slugs in
// `servers.tags`; the labels live here so they can be renamed without a data
// migration. Free-text tags are deliberately not supported — they invite
// near-duplicates ("Gaming"/"gamers"/"gaming!!") and moderation work.
//
// TAG_GROUPS is display-only (picker sections). Subgroups exist so the huge
// gaming vocabulary doesn't dominate the list; they are collapsed by default
// and expand automatically when a search or a selection needs them.

export const MAX_SERVER_TAGS = 5

const t = (id, label, aliases = []) => ({ id, label, aliases })

export const TAG_GROUPS = [
  {
    id: 'gaming',
    label: 'Gaming',
    tags: [
      t('gaming', 'Gaming'),
      t('esports', 'Esports', ['esport']),
      t('lfg', 'LFG / Looking for Group', ['looking for group', 'find group']),
      t('mobile-gaming', 'Mobile Gaming'),
      t('pc-gaming', 'PC Gaming'),
      t('console-gaming', 'Console Gaming'),
      t('indie-games', 'Indie Games'),
      t('retro-gaming', 'Retro Gaming'),
    ],
    subgroups: [
      {
        id: 'genres',
        label: 'Genres',
        tags: [
          t('fps', 'FPS', ['first person shooter']),
          t('rpg', 'RPG'),
          t('mmo', 'MMO'),
          t('sandbox', 'Sandbox'),
          t('survival', 'Survival'),
          t('strategy', 'Strategy'),
          t('simulation', 'Simulation', ['sim']),
          t('racing', 'Racing'),
          t('fighting', 'Fighting', ['fighting games']),
          t('horror', 'Horror'),
          t('competitive', 'Competitive', ['ranked']),
          t('casual', 'Casual'),
          t('co-op', 'Co-op', ['coop', 'cooperative']),
          t('battle-royale', 'Battle Royale', ['br']),
          t('tabletop', 'Tabletop & Card Games', ['board games', 'tabletop']),
        ],
      },
      {
        id: 'games',
        label: 'Games',
        tags: [
          t('minecraft', 'Minecraft'),
          t('roblox', 'Roblox'),
          t('fortnite', 'Fortnite'),
          t('valorant', 'Valorant'),
          t('league-of-legends', 'League of Legends', ['lol']),
          t('counter-strike', 'Counter-Strike', ['cs', 'csgo', 'cs2']),
          t('apex-legends', 'Apex Legends', ['apex']),
          t('call-of-duty', 'Call of Duty', ['cod']),
          t('gta', 'GTA', ['gta5', 'grand theft auto']),
          t('rocket-league', 'Rocket League'),
          t('pokemon', 'Pokémon', ['pokemon']),
          t('genshin-impact', 'Genshin Impact', ['genshin']),
        ],
      },
    ],
  },
  {
    id: 'entertainment',
    label: 'Entertainment & Media',
    tags: [
      t('entertainment', 'Entertainment'),
      t('movies-tv', 'Movies & TV', ['movies', 'film', 'tv', 'cinema']),
      t('anime-manga', 'Anime & Manga', ['anime', 'manga']),
      t('music', 'Music'),
      t('memes', 'Memes', ['meme']),
      t('books-writing', 'Books & Writing', ['books', 'writing', 'literature']),
      t('news-discussion', 'News & Discussion', ['news', 'politics', 'current events']),
      t('podcasts', 'Podcasts', ['podcast']),
      t('comics', 'Comics', ['comic books']),
      t('kpop', 'K-Pop', ['kpop']),
    ],
  },
  {
    id: 'community',
    label: 'Community & Social',
    tags: [
      t('community', 'Community'),
      t('social', 'Social', ['hangout']),
      t('support', 'Support', ['help']),
      t('roleplay', 'Roleplay', ['rp']),
      t('making-friends', 'Making Friends', ['friends']),
      t('events', 'Events', ['event']),
      t('fan-community', 'Fan Community', ['fandom', 'fan']),
      t('local-regional', 'Local / Regional', ['local', 'regional']),
      t('lgbtq', 'LGBTQ+', ['lgbt', 'lgbtqia']),
    ],
  },
  {
    id: 'creative',
    label: 'Creative',
    tags: [
      t('art-design', 'Art & Design', ['art', 'design']),
      t('photography', 'Photography', ['photo']),
      t('content-creation', 'Content Creation', ['content creator', 'creators']),
      t('streaming', 'Streaming', ['stream', 'twitch']),
      t('fashion', 'Fashion', ['style']),
      t('music-production', 'Music Production', ['producing', 'beatmaking']),
      t('game-development', 'Game Development', ['gamedev', 'game dev']),
      t('video-editing', 'Video Editing', ['editing', 'video']),
    ],
  },
  {
    id: 'tech',
    label: 'Tech & Learning',
    tags: [
      t('technology', 'Technology', ['tech']),
      t('programming', 'Programming', ['dev', 'code', 'coding', 'software']),
      t('science', 'Science'),
      t('education', 'Education', ['school', 'study', 'learning']),
      t('languages', 'Languages', ['language learning']),
      t('ai-ml', 'AI & Machine Learning', ['ai', 'ml', 'machine learning']),
      t('open-source', 'Open Source', ['opensource', 'oss']),
      t('cybersecurity', 'Cybersecurity', ['security', 'infosec']),
      t('study-group', 'Study Group', ['study']),
    ],
  },
  {
    id: 'business',
    label: 'Business & Money',
    tags: [
      t('business', 'Business'),
      t('finance', 'Finance', ['investing']),
      t('crypto', 'Crypto', ['cryptocurrency', 'btc', 'eth']),
      t('networking', 'Networking', ['professional']),
      t('startups', 'Startups', ['startup', 'entrepreneur']),
      t('jobs-freelance', 'Jobs & Freelance', ['jobs', 'freelance', 'hiring']),
    ],
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle',
    tags: [
      t('sports', 'Sports'),
      t('fitness', 'Fitness', ['gym', 'health']),
      t('food', 'Food', ['cooking', 'recipes']),
      t('travel', 'Travel'),
      t('cars-automotive', 'Cars & Automotive', ['cars', 'automotive']),
      t('pets-animals', 'Pets & Animals', ['pets', 'animals']),
      t('hobbies', 'Hobbies'),
      t('mental-wellness', 'Mental Wellness', ['wellbeing', 'wellness', 'mental health']),
      t('diy-crafts', 'DIY & Crafts', ['diy', 'crafts']),
    ],
  },
]

// Flat list of every tag, in display order.
export const ALL_SERVER_TAGS = TAG_GROUPS.flatMap((group) => [
  ...group.tags,
  ...(group.subgroups || []).flatMap((sub) => sub.tags),
])

export const SERVER_TAG_MAP = Object.fromEntries(ALL_SERVER_TAGS.map((tag) => [tag.id, tag]))

export function tagLabel(id) {
  return SERVER_TAG_MAP[id]?.label || id
}

export function tagLabels(ids) {
  return (Array.isArray(ids) ? ids : []).map(tagLabel)
}

// Normalise a query and a tag into the same shape so "K-Pop" matches "kpop",
// "AI & Machine Learning" matches "ai", and "Movies & TV" matches "film".
function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function tagMatchesQuery(tag, query) {
  const q = normalise(query)
  if (!q) return true
  return normalise(tag.label).includes(q)
    || normalise(tag.id).includes(q)
    || tag.aliases.some((alias) => normalise(alias).includes(q))
}

// Keeps a stored tag array clean: only known slugs, de-duplicated, capped.
export function sanitizeTags(ids) {
  const out = []
  for (const id of Array.isArray(ids) ? ids : []) {
    if (SERVER_TAG_MAP[id] && !out.includes(id)) out.push(id)
    if (out.length >= MAX_SERVER_TAGS) break
  }
  return out
}
