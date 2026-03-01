import { Router } from 'express';

const router = Router();

router.post('/api/transcribe', async (req, res) => {
  try {
    const { audio, mimeType } = req.body;
    const audioBuffer = Buffer.from(audio, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: mimeType || 'audio/webm' }), 'recording.webm');
    formData.append('model', 'voxtral-mini-latest');
    formData.append('language', 'en');
    const response = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}` },
      body: formData,
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Transcribe API error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
