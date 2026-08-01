import pb from '../pocketbase'

function statusColor(status) {
  if (status === 'idle') return 'orange'
  if (status === 'dnd') return 'red'
  if (status === 'offline') return 'gray'
  return 'limegreen'
}

function MembersSidebar({ members, ownerName, ownerStatus, ownerAvatarUrl }) {
  return (
    <div style={{ width: '220px', borderLeft: '1px solid #333', padding: '12px', flexShrink: 0 }}>
      <div style={{ fontSize: '0.8em', color: 'gray', textTransform: 'uppercase', marginBottom: '8px' }}>
        Members — {members.length + 1}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
        {ownerAvatarUrl ? (
          <img
            src={ownerAvatarUrl}
            alt=""
            style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#333' }} />
        )}
        <div>
          <div>
            {ownerName || 'Unknown'} 👑
          </div>
          <div style={{ fontSize: '0.8em', color: statusColor(ownerStatus) }}>
            {ownerStatus || 'online'}
          </div>
        </div>
      </div>

      {members.map((member) => {
        const user = member.expand?.user
        const status = user?.status === 'invisible' ? 'offline' : (user?.status || 'online')

        return (
          <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
            {user?.avatar ? (
              <img
                src={pb.files.getURL(user, user.avatar, { thumb: '28x28' })}
                alt=""
                style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#333' }} />
            )}
            <div>
              <div>{user?.name || 'Unknown'}</div>
              <div style={{ fontSize: '0.8em', color: statusColor(status) }}>{status}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default MembersSidebar