/** Temporary standalone NDJSON ingest for browser debug logs. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const LOG = '/opt/cursor/logs/debug.log';
const PORT = 7242;

fs.mkdirSync(path.dirname(LOG), { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'POST' && (req.url === '/ingest' || req.url === '/__agent_debug_log')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8').trim();
        if (body) fs.appendFileSync(LOG, body + '\n');
        res.writeHead(204);
        res.end();
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent-debug-log] listening on 127.0.0.1:${PORT} -> ${LOG}`);
});
