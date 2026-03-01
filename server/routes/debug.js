import { Router } from 'express';

const router = Router();

// Expose config to frontend
router.get('/api/config', (req, res) => {
  res.json({ ttydUrl: '/terminal/' });
});

// Remote debug logging (Quest → server console)
router.post('/api/log', (req, res) => {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[QUEST ${ts}] ${req.body.msg}`);
  res.json({ ok: true });
});

export default router;
