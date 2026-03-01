// Direct git endpoint — runs git commands on the server filesystem.
// Works both locally and in Docker (fallback when companion isn't available).
import { Router } from 'express';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const router = Router();

// Find a git repo: check workspace/, then workspace subdirs, then project root
function findGitRepo() {
  const candidates = [
    join(rootDir, 'workspace'),
    ...(() => {
      try {
        const wsDir = join(rootDir, 'workspace');
        if (!existsSync(wsDir)) return [];
        return readdirSync(wsDir)
          .map(f => join(wsDir, f))
          .filter(f => { try { return statSync(f).isDirectory(); } catch { return false; } });
      } catch { return []; }
    })(),
    rootDir,
  ];

  for (const dir of candidates) {
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe', timeout: 3000 });
      return dir;
    } catch {}
  }
  return null;
}

router.post('/api/git/run', (req, res) => {
  const { command, cwd } = req.query;
  if (!command) return res.status(400).json({ error: 'Missing command param' });

  // Only allow git commands (Express already URL-decodes query params)
  const cmd = command;
  if (!cmd.startsWith('git ')) {
    return res.status(400).json({ error: 'Only git commands allowed' });
  }

  let workDir;
  if (cwd && cwd !== '.') {
    workDir = resolve(rootDir, 'workspace', cwd);
  } else {
    workDir = findGitRepo();
  }

  if (!workDir) {
    return res.json({ stdout: '', stderr: 'No git repo found', returncode: 1 });
  }

  try {
    const stdout = execSync(cmd, { cwd: workDir, timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    res.json({ stdout: stdout.trim(), stderr: '', returncode: 0 });
  } catch (e) {
    res.json({
      stdout: (e.stdout || '').trim(),
      stderr: (e.stderr || e.message || '').trim(),
      returncode: e.status || 1,
    });
  }
});

export default router;
