// Scene control tests: POST API + WebSocket relay
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';

import sceneControlRoutes, { setupSceneControlWs } from '../server/routes/scene-control.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(sceneControlRoutes);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    const sceneControl = setupSceneControlWs(server);
    server.on('upgrade', (req, socket, head) => {
      if (req.url === '/ws/scene-control') {
        sceneControl.upgrade(req, socket, head);
      }
    });
    server.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function wsUrl(server) {
  return `ws://127.0.0.1:${server.address().port}/ws/scene-control`;
}

function connectWs(server) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(server));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

describe('Scene Control API', () => {
  let server, url;

  before(async () => {
    server = await listen(buildApp());
    url = baseUrl(server);
  });
  after(() => { server.close(); });

  it('rejects POST without action', async () => {
    const res = await fetch(`${url}/api/scene-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.match(data.error, /Missing action/);
  });

  it('accepts POST with action and reports 0 delivered when no WS clients', async () => {
    const res = await fetch(`${url}/api/scene-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load_git_tree' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.delivered, 0);
    assert.equal(data.action, 'load_git_tree');
  });

  it('delivers commands to connected WebSocket clients', async () => {
    const ws = await connectWs(server);
    const received = [];
    ws.on('message', (data) => received.push(JSON.parse(data)));

    // Small delay for connection to register
    await new Promise(r => setTimeout(r, 50));

    const res = await fetch(`${url}/api/scene-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'highlight_commit', commit: 'abc123', color: '#FF0000' }),
    });

    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.delivered, 1);

    // Wait for WebSocket message
    await new Promise(r => setTimeout(r, 50));
    assert.equal(received.length, 1);
    assert.equal(received[0].action, 'highlight_commit');
    assert.equal(received[0].commit, 'abc123');
    assert.equal(received[0].color, '#FF0000');

    ws.close();
  });

  it('delivers to multiple clients', async () => {
    const ws1 = await connectWs(server);
    const ws2 = await connectWs(server);
    const r1 = [], r2 = [];
    ws1.on('message', (d) => r1.push(JSON.parse(d)));
    ws2.on('message', (d) => r2.push(JSON.parse(d)));

    await new Promise(r => setTimeout(r, 50));

    const res = await fetch(`${url}/api/scene-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notification', message: 'Hello AR!' }),
    });

    const data = await res.json();
    assert.equal(data.delivered, 2);

    await new Promise(r => setTimeout(r, 50));
    assert.equal(r1.length, 1);
    assert.equal(r2.length, 1);
    assert.equal(r1[0].message, 'Hello AR!');

    ws1.close();
    ws2.close();
  });

  it('handles client disconnect gracefully', async () => {
    const ws = await connectWs(server);
    await new Promise(r => setTimeout(r, 50));

    // Verify client is connected
    const res1 = await fetch(`${url}/api/scene-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    });
    assert.equal((await res1.json()).delivered, 1);

    ws.close();
    await new Promise(r => setTimeout(r, 100));

    // After disconnect, should deliver to 0
    const res2 = await fetch(`${url}/api/scene-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test2' }),
    });
    assert.equal((await res2.json()).delivered, 0);
  });
});
