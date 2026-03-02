// Mistral proxy tests: MITM capture of streaming responses for TTS
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

import mistralProxyRoutes from '../server/routes/mistral-proxy.js';

const realFetch = globalThis.fetch;

function mockExternal(handler) {
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    return handler(u, opts);
  };
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(mistralProxyRoutes);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

describe('Mistral Proxy', () => {
  let server, url;

  before(async () => {
    process.env.MISTRAL_API_KEY = 'test-proxy-key';
    server = await listen(buildApp());
    url = baseUrl(server);
  });
  after(() => { server.close(); globalThis.fetch = realFetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('proxies non-streaming chat completions', async () => {
    const mockReply = {
      choices: [{ message: { role: 'assistant', content: 'Test reply here.' } }],
    };
    mockExternal(async (reqUrl, opts) => {
      assert.match(reqUrl, /api\.mistral\.ai\/v1\/chat\/completions/);
      assert.equal(opts.headers['Authorization'], 'Bearer test-proxy-key');
      return new Response(JSON.stringify(mockReply), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await realFetch(`${url}/mistral-proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'devstral-small-latest',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.choices[0].message.content, 'Test reply here.');
  });

  it('captures non-streaming response for TTS polling', async () => {
    mockExternal(async () => new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Hello there. How are you?' } }],
    }), { headers: { 'Content-Type': 'application/json' } }));

    await realFetch(`${url}/mistral-proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'devstral-small-latest',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    });

    // Poll response-chunks
    const chunksRes = await realFetch(`${url}/api/response-chunks?since=0`);
    const chunks = await chunksRes.json();
    assert.ok(chunks.done, 'Response should be done');
    assert.ok(chunks.chunks.length > 0, 'Should have at least one chunk');
    assert.ok(chunks.ts > 0, 'Should have a timestamp');
  });

  it('proxies streaming chat completions', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world."}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    mockExternal(async (reqUrl, opts) => {
      const body = JSON.parse(opts.body);
      assert.equal(body.stream, true);
      return new Response(sseData, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const res = await realFetch(`${url}/mistral-proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'devstral-small-latest',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Hello '), 'Should contain streamed content');
  });

  it('captures streaming response chunks for TTS', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"First sentence. "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Second sentence."}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    mockExternal(async () => new Response(sseData, {
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    await realFetch(`${url}/mistral-proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'devstral-small-latest',
        messages: [{ role: 'user', content: 'tell me two things' }],
        stream: true,
      }),
    });

    const chunksRes = await realFetch(`${url}/api/response-chunks?since=0`);
    const chunks = await chunksRes.json();
    assert.ok(chunks.done, 'Streaming should be done');
    assert.ok(chunks.chunks.length >= 1, 'Should have captured sentence chunks');
  });

  it('returns latest-response for legacy endpoint', async () => {
    mockExternal(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Legacy test content.' } }],
    }), { headers: { 'Content-Type': 'application/json' } }));

    await realFetch(`${url}/mistral-proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'devstral-small-latest',
        messages: [{ role: 'user', content: 'test' }],
        stream: false,
      }),
    });

    const res = await realFetch(`${url}/api/latest-response`);
    const data = await res.json();
    assert.ok(data.text.length > 0, 'Should have captured text');
    assert.ok(data.ts > 0, 'Should have a timestamp');
  });

  it('passes through non-chat endpoints transparently', async () => {
    mockExternal(async (reqUrl) => {
      assert.match(reqUrl, /api\.mistral\.ai\/v1\/models/);
      return new Response(JSON.stringify({ data: [{ id: 'devstral-small' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await realFetch(`${url}/mistral-proxy/v1/models`, {
      method: 'GET',
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.data[0].id === 'devstral-small');
  });
});
