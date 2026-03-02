import { Router } from 'express';

const router = Router();

router.post('/api/chat', async (req, res) => {
  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: req.body.model || 'mistral-small-latest',
        messages: req.body.messages,
        max_tokens: req.body.max_tokens || 200,
        temperature: req.body.temperature || 0.7,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Chat API error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
