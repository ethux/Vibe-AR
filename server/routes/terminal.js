import httpProxy from 'http-proxy';
import WebSocket from 'ws';

export function setupTerminalProxy(app, server, TTYD_URL) {
  const proxy = httpProxy.createProxyServer({ target: TTYD_URL, ws: true });
  proxy.on('error', (err) => console.error('Proxy error:', err.message));

  app.all('/terminal/*', (req, res) => {
    req.url = req.url.replace(/^\/terminal/, '');
    proxy.web(req, res);
  });

  // POST /api/terminal/exec — send a command to vibe-terminal via ttyd WebSocket
  app.post('/api/terminal/exec', (req, res) => {
    const command = req.query.command || (req.body && req.body.command);
    if (!command) return res.status(400).json({ error: 'Missing command parameter' });

    const wsUrl = TTYD_URL.replace(/^http/, 'ws') + '/ws';
    console.log(`[TERMINAL-EXEC] Connecting to ${wsUrl} to run: ${command}`);

    const ttydWs = new WebSocket(wsUrl);
    let done = false;
    let outputChunks = [];

    const finish = (status, body) => {
      if (done) return;
      done = true;
      try { ttydWs.close(); } catch {}
      const output = outputChunks.join('');
      console.log(`[TERMINAL-EXEC] Finished (${status}): ${JSON.stringify(body)}`);
      if (output) console.log(`[TERMINAL-EXEC] Terminal output (${output.length} chars): ${output.slice(0, 500)}`);
      res.status(status).json({ ...body, output: output.slice(0, 2000) });
    };

    ttydWs.on('open', () => {
      console.log(`[TERMINAL-EXEC] WebSocket connected to ttyd`);
      // ttyd binary protocol: INPUT type = ASCII '0' (0x30), NOT byte 0x00
      const input = '0' + command + '\n';
      ttydWs.send(input);
      console.log(`[TERMINAL-EXEC] Command sent (${input.length} bytes): ${command}`);
      // Wait a bit to collect some output, then close
      setTimeout(() => finish(200, { ok: true, command }), 500);
    });

    ttydWs.on('message', (data) => {
      // ttyd output: first byte is type ('0' = output), rest is terminal text
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length > 0) {
        const type = String.fromCharCode(buf[0]);
        const text = buf.slice(1).toString();
        if (type === '0') {
          // Terminal output
          outputChunks.push(text);
        } else {
          console.log(`[TERMINAL-EXEC] ttyd msg type=${type} len=${buf.length}`);
        }
      }
    });

    ttydWs.on('error', (err) => {
      console.error(`[TERMINAL-EXEC] WebSocket error: ${err.message}`);
      finish(502, { error: `Failed to connect to terminal: ${err.message}` });
    });

    ttydWs.on('close', (code, reason) => {
      console.log(`[TERMINAL-EXEC] WebSocket closed: code=${code} reason=${reason || 'none'}`);
      finish(200, { ok: true, command, note: 'ws closed early' });
    });

    // Timeout after 5s
    setTimeout(() => {
      console.warn(`[TERMINAL-EXEC] Timeout after 5s for command: ${command}`);
      finish(504, { error: 'Terminal connection timeout' });
    }, 5000);
  });

  // WebSocket upgrade
  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/terminal')) {
      req.url = req.url.replace(/^\/terminal/, '');
      proxy.ws(req, socket, head);
    }
  });

  return proxy;
}
