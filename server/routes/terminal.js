import httpProxy from 'http-proxy';

export function setupTerminalProxy(app, server, TTYD_URL) {
  const proxy = httpProxy.createProxyServer({ target: TTYD_URL, ws: true });
  proxy.on('error', (err) => console.error('Proxy error:', err.message));

  app.all('/terminal/*', (req, res) => {
    req.url = req.url.replace(/^\/terminal/, '');
    proxy.web(req, res);
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
