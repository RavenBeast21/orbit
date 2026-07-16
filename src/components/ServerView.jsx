// ServerView.jsx (new file)
function ServerView({ server }) {
  return (
    <div>
      <p style={{ color: 'lightgreen' }}>Server successfully created</p>
      <h1>{server.name}</h1>
      <p>Type: {server.type}</p>
    </div>
  )
}

export default ServerView