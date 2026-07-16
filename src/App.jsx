import { useState, useEffect } from 'react'
import PocketBase from 'pocketbase'

const pb = new PocketBase('http://127.0.0.1:8090')

function App() {
  const [servers, setServers] = useState([])

  useEffect(() => {
    pb.collection('servers').getFullList().then((records) => {
      setServers(records)
    })
  }, [])

  return (
    <div>
      <h1>Orbit — PocketBase Connection Test</h1>
      <p>Servers found: {servers.length}</p>
      <ul>
        {servers.map((server) => (
          <li key={server.id}>{server.name}</li>
        ))}
      </ul>
    </div>
  )
}

export default App
