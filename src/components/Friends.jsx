// Friends.jsx
import { useState, useEffect } from 'react'
import pb from '../pocketbase'

function Friends({ onBack, onMessageFriend }) {
  const [searchInput, setSearchInput] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchSuccess, setSearchSuccess] = useState('')
  const [searching, setSearching] = useState(false)

  const [incomingRequests, setIncomingRequests] = useState([])
  const [outgoingRequests, setOutgoingRequests] = useState([])
  const [friendsList, setFriendsList] = useState([])

  const uid = pb.authStore.model.id

  const loadEverything = async () => {
    try {
      const incoming = await pb.collection('friend_requests').getFullList({
        filter: `to_user="${uid}" && status="pending"`,
        expand: 'from_user',
      })
      setIncomingRequests(incoming)

      const outgoing = await pb.collection('friend_requests').getFullList({
        filter: `from_user="${uid}" && status="pending"`,
        expand: 'to_user',
      })
      setOutgoingRequests(outgoing)

      const friendsA = await pb.collection('friends').getFullList({
        filter: `user_a="${uid}"`,
        expand: 'user_b',
      })
      const friendsB = await pb.collection('friends').getFullList({
        filter: `user_b="${uid}"`,
        expand: 'user_a',
      })

      const combinedFriends = [
        ...friendsA.map((f) => ({ recordId: f.id, user: f.expand?.user_b })),
        ...friendsB.map((f) => ({ recordId: f.id, user: f.expand?.user_a })),
      ]
      setFriendsList(combinedFriends)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadEverything()

    pb.collection('friend_requests').subscribe('*', (e) => {
      if (e.record.from_user === uid || e.record.to_user === uid) {
        loadEverything()
      }
    })

    pb.collection('friends').subscribe('*', (e) => {
      if (e.record.user_a === uid || e.record.user_b === uid) {
        loadEverything()
      }
    })

    return () => {
      pb.collection('friend_requests').unsubscribe('*')
      pb.collection('friends').unsubscribe('*')
    }
  }, [])

  const handleSendRequest = async (e) => {
    e.preventDefault()
    setSearchError('')
    setSearchSuccess('')

    if (!searchInput.trim()) {
      setSearchError('Enter a username or ID')
      return
    }

    setSearching(true)

    try {
      const matches = await pb.collection('users').getFullList({
        filter: `username="${searchInput.trim()}" || id="${searchInput.trim()}"`,
      })

      if (matches.length === 0) {
        setSearchError('No user found with that username or ID')
        return
      }

      const targetUser = matches[0]

      if (targetUser.id === uid) {
        setSearchError("You can't add yourself")
        return
      }

      const alreadyFriends = friendsList.some((f) => f.user?.id === targetUser.id)
      if (alreadyFriends) {
        setSearchError('You are already friends with this user')
        return
      }

      const existingRequest = await pb.collection('friend_requests').getFullList({
        filter: `(from_user="${uid}" && to_user="${targetUser.id}") || (from_user="${targetUser.id}" && to_user="${uid}")`,
      })
      if (existingRequest.some((r) => r.status === 'pending')) {
        setSearchError('A pending request already exists with this user')
        return
      }

      await pb.collection('friend_requests').create({
        from_user: uid,
        to_user: targetUser.id,
        status: 'pending',
      })

      setSearchSuccess('Friend request sent')
      setSearchInput('')
      loadEverything()
    } catch (err) {
      console.error(err)
      setSearchError('Something went wrong sending the request')
    } finally {
      setSearching(false)
    }
  }

  const handleAccept = async (request) => {
    try {
      await pb.collection('friend_requests').update(request.id, { status: 'accepted' })
      await pb.collection('friends').create({
        user_a: request.from_user,
        user_b: request.to_user,
      })
      loadEverything()
    } catch (err) {
      console.error(err)
    }
  }

  const handleReject = async (request) => {
    try {
      await pb.collection('friend_requests').update(request.id, { status: 'rejected' })
      loadEverything()
    } catch (err) {
      console.error(err)
    }
  }

  const handleUnfriend = async (recordId) => {
    try {
      await pb.collection('friends').delete(recordId)
      loadEverything()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h1>Friends</h1>

      <h2>Add a Friend</h2>
      <form onSubmit={handleSendRequest}>
        <input
          type="text"
          placeholder="Username or ID"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" disabled={searching}>
          {searching ? 'Sending...' : 'Send Request'}
        </button>
      </form>
      {searchError && <p style={{ color: 'red' }}>{searchError}</p>}
      {searchSuccess && <p style={{ color: 'lightgreen' }}>{searchSuccess}</p>}

      <hr />

      <h2>Incoming Requests</h2>
      {incomingRequests.length === 0 && <p>No incoming requests.</p>}
      <ul>
        {incomingRequests.map((req) => (
          <li key={req.id}>
            {req.expand?.from_user?.name || 'Unknown'} (@{req.expand?.from_user?.username})
            {' '}
            <button onClick={() => handleAccept(req)}>Accept</button>
            <button onClick={() => handleReject(req)}>Reject</button>
          </li>
        ))}
      </ul>

      <h2>Outgoing Requests</h2>
      {outgoingRequests.length === 0 && <p>No outgoing requests.</p>}
      <ul>
        {outgoingRequests.map((req) => (
          <li key={req.id}>
            {req.expand?.to_user?.name || 'Unknown'} (@{req.expand?.to_user?.username}) — pending
          </li>
        ))}
      </ul>

      <hr />

      <h2>Your Friends</h2>
      {friendsList.length === 0 && <p>No friends yet.</p>}
      <ul>
        {friendsList.map((f) => (
          <li key={f.recordId}>
            {f.user?.name || 'Unknown'} (@{f.user?.username})
            {' '}
            <button onClick={() => onMessageFriend(f.user.id)}>Message</button>
            {' '}
            <button onClick={() => handleUnfriend(f.recordId)}>Unfriend</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Friends