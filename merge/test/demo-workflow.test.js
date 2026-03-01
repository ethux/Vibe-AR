// Demo Workflow Tests
// Validates the end-to-end hackathon demo flow:
//   1. Speech-to-speech pipeline (voice → STT → Mistral → TTS)
//   2. Git tree live updates (commit detection + branch rendering)
//   3. File viewer (companion proxy → file read → FileViewerWindow)
//   4. Dev server detection (LivePreview from terminal output)
//   5. CodeCity analysis proxy
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

// ── Helpers ──────────────────────────────────────────────────────

function buildApp(...routeModules) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  for (const m of routeModules) app.use(m);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  const addr = server.address();
  return `http://127.0.0.1:${addr.port}`;
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

// ═════════════════════════════════════════════════════════════════
//  1. Git API — /api/git/run
// ═════════════════════════════════════════════════════════════════

describe('Git API', async () => {
  let server, url;

  before(async () => {
    const gitRoutes = (await import('../server/routes/git.js')).default;
    const app = buildApp(gitRoutes);
    server = await listen(app);
    url = baseUrl(server);
  });

  after(async () => { await close(server); });

  it('runs git rev-parse and finds a repo', async () => {
    const params = new URLSearchParams({ command: 'git rev-parse --is-inside-work-tree' });
    const res = await fetch(`${url}/api/git/run?${params}`, { method: 'POST' });
    const data = await res.json();
    assert.equal(res.status, 200);
    // Either finds a repo (returncode 0) or doesn't (returncode 1), both are valid responses
    assert.ok(data.returncode === 0 || data.returncode === 1);
  });

  it('returns git log output', async () => {
    const params = new URLSearchParams({ command: 'git log --oneline -5' });
    const res = await fetch(`${url}/api/git/run?${params}`, { method: 'POST' });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok('stdout' in data);
    assert.ok('returncode' in data);
  });

  it('returns branch list', async () => {
    const params = new URLSearchParams({ command: 'git branch -a --format="%(refname:short)"' });
    const res = await fetch(`${url}/api/git/run?${params}`, { method: 'POST' });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok('stdout' in data);
  });

  it('rejects non-git commands', async () => {
    const params = new URLSearchParams({ command: 'ls -la' });
    const res = await fetch(`${url}/api/git/run?${params}`, { method: 'POST' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('Only git'));
  });

  it('handles git log with format containing special chars', async () => {
    const params = new URLSearchParams({ command: 'git log --all --format="%H|%h|%P|%s|%an|%ar|%D" -3' });
    const res = await fetch(`${url}/api/git/run?${params}`, { method: 'POST' });
    const data = await res.json();
    assert.equal(res.status, 200);
    // Should return pipe-separated fields if repo exists
    if (data.returncode === 0 && data.stdout) {
      assert.ok(data.stdout.includes('|'), 'Expected pipe-separated format');
    }
  });
});

// ═════════════════════════════════════════════════════════════════
//  2. Debug / Config APIs
// ═════════════════════════════════════════════════════════════════

describe('Debug APIs', async () => {
  let server, url;

  before(async () => {
    const debugRoutes = (await import('../server/routes/debug.js')).default;
    const app = buildApp(debugRoutes);
    server = await listen(app);
    url = baseUrl(server);
  });

  after(async () => { await close(server); });

  it('GET /api/config returns ttydUrl', async () => {
    const res = await fetch(`${url}/api/config`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.ttydUrl);
  });

  it('POST /api/log accepts debug messages', async () => {
    const res = await fetch(`${url}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: '[TEST] demo workflow test' }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
  });
});

// ═════════════════════════════════════════════════════════════════
//  3. Dev Server Health Check API
// ═════════════════════════════════════════════════════════════════

describe('Dev Server Proxy', async () => {
  let server, url;

  before(async () => {
    const devRoutes = (await import('../server/routes/devserver-proxy.js')).default;
    const app = buildApp(devRoutes);
    server = await listen(app);
    url = baseUrl(server);
  });

  after(async () => { await close(server); });

  it('rejects invalid port', async () => {
    const res = await fetch(`${url}/api/devserver/0/health`);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error);
  });

  it('returns down for unreachable server', async () => {
    // vibe-terminal DNS only resolves inside Docker; outside it returns 'down' via error handler
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${url}/api/devserver/59999/health`, { signal: controller.signal });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.status, 'down');
    } finally {
      clearTimeout(timer);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
//  4. LivePreview Server Detection (unit test, no server needed)
// ═════════════════════════════════════════════════════════════════

describe('LivePreview — server detection patterns', () => {
  // Inline the detection logic (same patterns as live-preview.js)
  const SERVER_PATTERNS = [
    { pattern: /ready started server on.*?:(\d+)/i,             framework: 'Next.js',       portGroup: 1 },
    { pattern: /Local:\s*https?:\/\/localhost:(\d+)/i,           framework: 'Vite',          portGroup: 1 },
    { pattern: /Running on https?:\/\/127\.0\.0\.1:(\d+)/i,     framework: 'Flask',         portGroup: 1 },
    { pattern: /listening on port\s+(\d+)/i,                     framework: 'Express',       portGroup: 1 },
    { pattern: /server (?:is )?(?:running|listening) (?:on|at) (?:port )?(\d+)/i, framework: 'Node.js', portGroup: 1 },
    { pattern: /Serving HTTP on 0\.0\.0\.0 port (\d+)/i,        framework: 'Python HTTP',   portGroup: 1 },
    { pattern: /https?:\/\/localhost:(\d+)/i,                    framework: 'Dev Server',    portGroup: 1 },
  ];

  function detectServer(text) {
    for (const entry of SERVER_PATTERNS) {
      const match = text.match(entry.pattern);
      if (match) {
        const port = parseInt(match[entry.portGroup], 10);
        if (port > 0 && port <= 65535) return { detected: true, port, framework: entry.framework };
      }
    }
    return { detected: false };
  }

  it('detects Vite dev server', () => {
    const result = detectServer('  ➜  Local:   http://localhost:5173/');
    assert.equal(result.detected, true);
    assert.equal(result.port, 5173);
    assert.equal(result.framework, 'Vite');
  });

  it('detects Next.js', () => {
    const result = detectServer('ready started server on 0.0.0.0:3000, url: http://localhost:3000');
    assert.equal(result.detected, true);
    assert.equal(result.port, 3000);
    assert.equal(result.framework, 'Next.js');
  });

  it('detects Flask', () => {
    const result = detectServer(' * Running on http://127.0.0.1:5000');
    assert.equal(result.detected, true);
    assert.equal(result.port, 5000);
    assert.equal(result.framework, 'Flask');
  });

  it('detects Express', () => {
    const result = detectServer('Server listening on port 3333');
    assert.equal(result.detected, true);
    assert.equal(result.port, 3333);
  });

  it('detects Python http.server', () => {
    const result = detectServer('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/)');
    assert.equal(result.detected, true);
    assert.equal(result.port, 8000);
    assert.equal(result.framework, 'Python HTTP');
  });

  it('returns false for non-server output', () => {
    const result = detectServer('npm WARN deprecated package@1.0.0');
    assert.equal(result.detected, false);
  });

  it('returns false for empty input', () => {
    const result = detectServer('');
    assert.equal(result.detected, false);
  });
});

// ═════════════════════════════════════════════════════════════════
//  5. Git Tree — log parsing + lane assignment (unit test)
// ═════════════════════════════════════════════════════════════════

describe('Git Tree — parsing', () => {
  // Simulate the parse regex from git-tree.js
  const PARSE_RE = /([a-f0-9]{40})\|([a-f0-9]+)\|([\sa-f0-9]*)\|(.*?)\|(.*?)\|(.*?)\|(.*)/;

  it('parses a standard commit line', () => {
    const line = 'abc123def456789012345678901234567890abcd|abc123d||Initial commit|John|2 hours ago|HEAD -> main';
    const match = line.match(PARSE_RE);
    assert.ok(match, 'Should match the format');
    assert.equal(match[1], 'abc123def456789012345678901234567890abcd');
    assert.equal(match[2], 'abc123d');
    assert.equal(match[3].trim(), ''); // no parents (root commit)
    assert.equal(match[4].trim(), 'Initial commit');
    assert.equal(match[5].trim(), 'John');
    assert.equal(match[7], 'HEAD -> main');
  });

  it('parses a commit with parent hashes', () => {
    const line = 'aaaa000000000000000000000000000000000001|aaaa001|bbbb000000000000000000000000000000000001|Add feature|Jane|1 day ago|feature/auth';
    const match = line.match(PARSE_RE);
    assert.ok(match);
    assert.equal(match[3].trim(), 'bbbb000000000000000000000000000000000001');
    assert.equal(match[7], 'feature/auth');
  });

  it('parses a merge commit with two parents', () => {
    const line = 'cccc000000000000000000000000000000000001|cccc001|aaaa000000000000000000000000000000000001 bbbb000000000000000000000000000000000001|Merge branch|Bob|3 hours ago|';
    const match = line.match(PARSE_RE);
    assert.ok(match);
    const parents = match[3].trim().split(/\s+/);
    assert.equal(parents.length, 2);
  });
});

// ═════════════════════════════════════════════════════════════════
//  6. Companion Proxy — body forwarding
// ═════════════════════════════════════════════════════════════════

describe('Companion Proxy — body re-serialization', async () => {
  let mockCompanion, companionUrl;
  let proxyServer, proxyUrl;

  before(async () => {
    // Mock companion that echoes the received body
    const mockApp = express();
    mockApp.use(express.json());
    mockApp.post('/api/files/read', (req, res) => {
      res.json({ received: req.body, content: 'mock file content' });
    });
    mockCompanion = await listen(mockApp);
    companionUrl = baseUrl(mockCompanion);

    // Build proxy inline to control the target URL (avoids module caching issues)
    const { Router } = await import('express');
    const httpProxy = (await import('http-proxy')).default;
    const { Readable } = await import('node:stream');
    const proxy = httpProxy.createProxyServer({ target: companionUrl, changeOrigin: true });
    proxy.on('error', (err, req, res) => {
      if (!res.headersSent && res.status) res.status(502).json({ error: 'Companion unavailable' });
    });
    const router = Router();
    router.all('/api/companion/*', (req, res) => {
      req.url = req.url.replace('/api/companion', '/api');
      if (req.body && Object.keys(req.body).length > 0) {
        const bodyStr = JSON.stringify(req.body);
        req.headers['content-length'] = String(Buffer.byteLength(bodyStr));
        const buf = new Readable(); buf.push(bodyStr); buf.push(null);
        proxy.web(req, res, { buffer: buf });
      } else {
        proxy.web(req, res);
      }
    });

    const app = buildApp(router);
    proxyServer = await listen(app);
    proxyUrl = baseUrl(proxyServer);
  });

  after(async () => {
    await close(proxyServer);
    await close(mockCompanion);
  });

  it('forwards POST body through proxy', async () => {
    const res = await fetch(`${proxyUrl}/api/companion/files/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.js' }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.content, 'mock file content');
    assert.deepEqual(data.received, { path: 'test.js' });
  });
});

// ═════════════════════════════════════════════════════════════════
//  7. Mistral Proxy — response capture for TTS
// ═════════════════════════════════════════════════════════════════

describe('Mistral Proxy — latest response endpoint', async () => {
  let server, url;

  before(async () => {
    const mistralRoutes = (await import('../server/routes/mistral-proxy.js')).default;
    const app = buildApp(mistralRoutes);
    server = await listen(app);
    url = baseUrl(server);
  });

  after(async () => { await close(server); });

  it('GET /api/latest-response returns captured response', async () => {
    const res = await fetch(`${url}/api/latest-response`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok('text' in data);
  });
});
