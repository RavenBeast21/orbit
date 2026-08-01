import pb from './pocketbase'

// Checks whether a given user has a specific permission in a specific server.
// Returns true immediately if they're the server owner (owner bypasses
// the role system entirely, per Orbit's design). Otherwise checks every
// role they hold via member_roles — true if ANY held role grants it.
//
// permissionKey must be one of the exact Bool field names on the roles
// collection, e.g. 'manage_roles', 'kick_members', 'manage_channels'.
export async function hasPermission(userId, server, permissionKey) {
  if (!userId || !server) return false

  if (server.owner === userId) return true

  try {
    const membership = await pb.collection('members').getFirstListItem(
      `user="${userId}" && server="${server.id}"`
    )

    const links = await pb.collection('member_roles').getFullList({
      filter: `member="${membership.id}"`,
      expand: 'role',
    })

    return links.some((link) => link.expand?.role?.[permissionKey] === true)
  } catch (err) {
    // Not a member at all, or some other lookup failure — no permission.
    return false
  }
}

// Same as hasPermission, but also checks per-channel overwrites, then
// per-category overwrites (the "sync" — a channel inherits its category's
// overwrites unless it has its own explicit one for that exact permission).
// Rules:
// - Owner always allowed, everywhere.
// - If ANY role the user holds has an explicit DENY overwrite on the
//   CHANNEL for this exact permission, they are denied — deny always wins,
//   and this is checked BEFORE category overwrites (a channel's own
//   setting always takes priority over its category's).
// - Otherwise if ANY held role has an explicit ALLOW overwrite on the
//   channel, allowed.
// - If the channel has no relevant overwrite at all (neither allow nor
//   deny) AND the channel belongs to a category, fall back to checking
//   that category's overwrites the same way (deny beats allow).
// - Otherwise falls back to the normal server-wide permission check —
//   EXCEPT for 'view_channel', which has no server-wide equivalent and
//   defaults to visible (true) when nothing else says otherwise.
export async function hasChannelPermission(userId, server, channel, permissionKey) {
  if (!userId || !server || !channel) return false

  if (server.owner === userId) return true

  try {
    const membership = await pb.collection('members').getFirstListItem(
      `user="${userId}" && server="${server.id}"`
    )

    const links = await pb.collection('member_roles').getFullList({
      filter: `member="${membership.id}"`,
      expand: 'role',
    })

    const heldRoleIds = links.map((link) => link.role)

    if (heldRoleIds.length > 0) {
      const channelOverwrites = await pb.collection('channel_overwrites').getFullList({
        filter: `channel="${channel.id}" && permission="${permissionKey}"`,
      })

      const relevantChannelOverwrites = channelOverwrites.filter((o) => heldRoleIds.includes(o.role))

      if (relevantChannelOverwrites.some((o) => o.allow === false)) return false
      if (relevantChannelOverwrites.some((o) => o.allow === true)) return true

      if (channel.category) {
        const categoryOverwrites = await pb.collection('category_overwrites').getFullList({
          filter: `category="${channel.category}" && permission="${permissionKey}"`,
        })

        const relevantCategoryOverwrites = categoryOverwrites.filter((o) => heldRoleIds.includes(o.role))

        if (relevantCategoryOverwrites.some((o) => o.allow === false)) return false
        if (relevantCategoryOverwrites.some((o) => o.allow === true)) return true
      }
    }

    if (permissionKey === 'view_channel') return true

    return links.some((link) => link.expand?.role?.[permissionKey] === true)
  } catch (err) {
    // Not a member at all, or some other lookup failure.
    // view_channel still defaults to visible for consistency; anything
    // else defaults to no permission.
    return permissionKey === 'view_channel'
  }
}

// Same idea as hasChannelPermission, but for a category directly (not one
// of its channels). Used to gate category-level actions (e.g. whether
// someone can manage/create channels within THIS category specifically),
// separately from the server-wide manage_channels toggle.
export async function hasCategoryPermission(userId, server, category, permissionKey) {
  if (!userId || !server || !category) return false

  if (server.owner === userId) return true

  try {
    const membership = await pb.collection('members').getFirstListItem(
      `user="${userId}" && server="${server.id}"`
    )

    const links = await pb.collection('member_roles').getFullList({
      filter: `member="${membership.id}"`,
      expand: 'role',
    })

    const heldRoleIds = links.map((link) => link.role)

    if (heldRoleIds.length > 0) {
      const categoryOverwrites = await pb.collection('category_overwrites').getFullList({
        filter: `category="${category.id}" && permission="${permissionKey}"`,
      })

      const relevantOverwrites = categoryOverwrites.filter((o) => heldRoleIds.includes(o.role))

      if (relevantOverwrites.some((o) => o.allow === false)) return false
      if (relevantOverwrites.some((o) => o.allow === true)) return true
    }

    if (permissionKey === 'view_channel') return true

    return links.some((link) => link.expand?.role?.[permissionKey] === true)
  } catch (err) {
    return permissionKey === 'view_channel'
  }
}