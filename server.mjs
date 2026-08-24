import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';

const PORT = 1234;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ReView — sync server');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req, { gc: true });
});

function onListenError(err) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
    console.log(`[review] sync already running on :${PORT}`);
    process.exit(0);
  }
  throw err;
}

server.on('error', onListenError);
wss.on('error', onListenError);

server.listen(PORT, () => {
  console.log(`[review] sync server: ws://localhost:${PORT}`);
});
