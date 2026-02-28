import { Router } from 'express';

const router = Router();

router.post('/api/tts', async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(501).json({ error: 'ElevenLabs not configured' });
  }
  try {
    const { text, voice_id } = req.body;
    const vid = voice_id || '21m00Tcm4TlvDq8ikWAM';
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('Transfer-Encoding', 'chunked');
    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(Buffer.from(value));
      }
    };
    pump().catch(err => { console.error('TTS stream error:', err); res.end(); });
  } catch (err) {
    console.error('TTS API error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
