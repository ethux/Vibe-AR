// ── Scene Control API ──
// Receives commands from the MCP server and relays them to AR clients via WebSocket.
import { Router } from 'express';
import { WebSocketServer } from 'ws';

const router = Router();

// All connected AR clients — broadcast commands to all of them
const clients = new Set();

// POST /api/scene-control — MCP server sends commands here
router.post('/api/scene-control', (req, res) => {
  const command = req.body;
  if (!command || !command.action) {
    return res.status(400).json({ ok: false, error: 'Missing action' });
  }

  console.log(`[SCENE-CONTROL] ➜ Relaying action: ${command.action}`, JSON.stringify(command).slice(0, 200));

  let delivered = 0;
  const msg = JSON.stringify(command);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(msg);
      delivered++;
    }
  }

  console.log(`[SCENE-CONTROL] ➜ Delivered "${command.action}" to ${delivered}/${clients.size} client(s)`);
  res.json({ ok: true, delivered, action: command.action });
});

// Setup WebSocket server for AR clients
function setupSceneControlWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[SCENE-CONTROL] Client connected (${clients.size} total)`);
    ws.on('close', () => {
      clients.delete(ws);
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
