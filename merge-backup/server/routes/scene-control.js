// ── Scene Control API ──
// Receives commands from the MCP server and relays them to AR clients via WebSocket.
import { Router } from 'express';
import { WebSocketServer } from 'ws';

const router = Router();

// Only the latest AR client is active — prevents double commands on page reload
let activeClient = null;
const clients = new Set();

// POST /api/scene-control — MCP server sends commands here
router.post('/api/scene-control', (req, res) => {
  const command = req.body;
  if (!command || !command.action) {
    return res.status(400).json({ ok: false, error: 'Missing action' });
  }

  let delivered = 0;
  if (activeClient && activeClient.readyState === 1) {
    activeClient.send(JSON.stringify(command));
    delivered = 1;
  }

  res.json({ ok: true, delivered, action: command.action });
});

// Setup WebSocket server for AR clients
function setupSceneControlWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    // New client takes over — close any stale previous client
    if (activeClient && activeClient !== ws && activeClient.readyState === 1) {
      console.log('[SCENE-CONTROL] Closing stale client');
      activeClient.close();
    }
    activeClient = ws;
    clients.add(ws);
    console.log(`[SCENE-CONTROL] Client connected (active), ${clients.size} total`);
    ws.on('close', () => {
      clients.delete(ws);
      if (activeClient === ws) activeClient = null;
      console.log(`[SCENE-CONTROL] Client disconnected (${clients.size} total)`);
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        console.log(`[SCENE-CONTROL] Client response:`, msg);
      } catch {}
    });
  });

  return { wss, upgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)) };
}

export { setupSceneControlWs };
export default router;
