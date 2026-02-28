// Voice flow integration tests: STT → Chat → TTS
// Uses Node built-in test runner + mocked fetch for external APIs
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

import chatRoutes from '../server/routes/chat.js';
import transcribeRoutes from '../server/routes/transcribe.js';
import ttsRoutes from '../server/routes/tts.js';

// Save the real fetch — used for test HTTP calls to local server
const realFetch = globalThis.fetch;

// Mock that only intercepts external API calls, passes local through
let externalMock = null;
function mockExternal(handler) {
  externalMock = handler;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === 'string' ? url : url.toString();
    // Local requests → real fetch
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    // External → mock
    return handler(u, opts);
  };
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(chatRoutes);
  app.use(transcribeRoutes);
  app.use(ttsRoutes);
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

// ─── Tests ───

describe('/api/chat', () => {
  let server, url;

  before(async () => {
    process.env.MISTRAL_API_KEY = 'test-key-123';
    server = await listen(buildApp());
    url = baseUrl(server);
  });
  after(() => { server.close(); globalThis.fetch = realFetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('forwards messages to Mistral and returns the response', async () => {
    const mockResponse = {
      choices: [{ message: { role: 'assistant', content: 'Hello there!' } }],
    };
    mockExternal(async (reqUrl, opts) => {
      assert.match(reqUrl, /mistral\.ai.*chat\/completions/);
      const body = JSON.parse(opts.body);
      assert.equal(body.model, 'mistral-small-latest');
      assert.equal(body.messages.length, 2);
      assert.equal(opts.headers['Authorization'], 'Bearer test-key-123');
      return new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await realFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello?' },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.choices[0].message.content, 'Hello there!');
  });

  it('uses default model/max_tokens/temperature when not provided', async () => {
    mockExternal(async (reqUrl, opts) => {
      const body = JSON.parse(opts.body);
      assert.equal(body.model, 'mistral-small-latest');
      assert.equal(body.max_tokens, 200);
      assert.equal(body.temperature, 0.7);
      return new Response(JSON.stringify({ choices: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await realFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
  });

  it('returns 500 when Mistral API throws', async () => {
    mockExternal(async () => { throw new Error('network down'); });

    const res = await realFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.match(data.error, /network down/);
  });
});

describe('/api/transcribe', () => {
  let server, url;

  before(async () => {
    process.env.MISTRAL_API_KEY = 'test-key-123';
    server = await listen(buildApp());
    url = baseUrl(server);
  });
  after(() => { server.close(); globalThis.fetch = realFetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('sends audio to Voxtral and returns transcription', async () => {
    const fakeAudio = Buffer.from('fake audio data').toString('base64');

    mockExternal(async (reqUrl, opts) => {
      assert.match(reqUrl, /mistral\.ai.*audio\/transcriptions/);
      assert.equal(opts.headers['Authorization'], 'Bearer test-key-123');
      assert.ok(opts.body); // FormData
      return new Response(JSON.stringify({ text: 'Hello world' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await realFetch(`${url}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: fakeAudio, mimeType: 'audio/webm' }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.text, 'Hello world');
  });

  it('returns 500 when Mistral STT throws', async () => {
    mockExternal(async () => { throw new Error('STT failed'); });

    const res = await realFetch(`${url}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: 'aGVsbG8=', mimeType: 'audio/webm' }),
    });
    assert.equal(res.status, 500);
  });
});

describe('/api/tts', () => {
  let server, url;

  before(async () => {
    server = await listen(buildApp());
    url = baseUrl(server);
  });
  after(() => { server.close(); globalThis.fetch = realFetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('returns 501 when ELEVENLABS_API_KEY is not set', async () => {
    delete process.env.ELEVENLABS_API_KEY;

    const res = await realFetch(`${url}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });
    assert.equal(res.status, 501);
    const data = await res.json();
    assert.match(data.error, /not configured/i);
  });

  it('streams PCM audio from ElevenLabs', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-eleven-key';
    const fakePCM = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

    mockExternal(async (reqUrl, opts) => {
      assert.match(reqUrl, /elevenlabs\.io/);
      assert.equal(opts.headers['xi-api-key'], 'test-eleven-key');
      const body = JSON.parse(opts.body);
      assert.equal(body.text, 'Hello world');
      assert.equal(body.model_id, 'eleven_flash_v2_5');
      return new Response(fakePCM, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    });

    const res = await realFetch(`${url}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello world' }),
    });

    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0);
  });

  it('uses default voice_id (21m00Tcm4TlvDq8ikWAM)', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-eleven-key';

    mockExternal(async (reqUrl) => {
      // The voice_id is in the URL path
      assert.match(reqUrl, /21m00Tcm4TlvDq8ikWAM/);
      return new Response(new Uint8Array(0), { status: 200 });
    });

    const res = await realFetch(`${url}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(res.status, 200);
  });

  it('forwards ElevenLabs error status', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-eleven-key';

    mockExternal(async () => new Response('rate limited', { status: 429 }));

    const res = await realFetch(`${url}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(res.status, 429);
  });
});

describe('Full voice flow: STT → Chat → TTS', () => {
  let server, url;

  before(async () => {
    process.env.MISTRAL_API_KEY = 'test-key-123';
    process.env.ELEVENLABS_API_KEY = 'test-eleven-key';
    server = await listen(buildApp());
    url = baseUrl(server);
  });
  after(() => { server.close(); globalThis.fetch = realFetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('completes the full pipeline: transcribe → chat → tts', async () => {
    const callLog = [];

    mockExternal(async (reqUrl, opts) => {
      if (reqUrl.includes('audio/transcriptions')) {
        callLog.push('transcribe');
        return new Response(JSON.stringify({ text: 'Create a hello world app' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (reqUrl.includes('chat/completions')) {
        callLog.push('chat');
        const body = JSON.parse(opts.body);
        assert.ok(body.messages.some(m => m.content.includes('Create a hello world app')));
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'Sure, I will create a hello world application for you.' } }],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (reqUrl.includes('elevenlabs.io')) {
        callLog.push('tts');
        const body = JSON.parse(opts.body);
        assert.match(body.text, /hello world application/);
        return new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 });
      }
      throw new Error(`Unexpected external call: ${reqUrl}`);
    });

    // Step 1: Transcribe audio
    const sttRes = await realFetch(`${url}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: Buffer.from('fake').toString('base64') }),
    });
    const { text: userText } = await sttRes.json();
    assert.equal(userText, 'Create a hello world app');

    // Step 2: Get chat reply (what speakReply does)
    const chatRes = await realFetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: 'You are a helpful coding assistant. Give a brief spoken reply.' },
          { role: 'user', content: userText },
        ],
        max_tokens: 200,
      }),
    });
    const chatData = await chatRes.json();
    const reply = chatData.choices[0].message.content;
    assert.match(reply, /hello world/);

    // Step 3: Speak it
    const ttsRes = await realFetch(`${url}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: reply }),
    });
    assert.equal(ttsRes.status, 200);
    const pcm = Buffer.from(await ttsRes.arrayBuffer());
    assert.ok(pcm.length > 0);

    // Verify correct order
    assert.deepEqual(callLog, ['transcribe', 'chat', 'tts']);
  });
});
