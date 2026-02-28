// ═══════════════════════════════════════════════════════════════════
//  voice-commands.js — Voice-to-Terminal Command Processor
//  Parses voice transcriptions into terminal commands via Mistral AI
// ═══════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a voice command parser for a coding terminal. The user speaks commands naturally and you convert them to exact terminal commands.

Rules:
- Return ONLY the terminal command, nothing else
- If the user says "create file X" → echo appropriate content or touch
- If the user says "run X" or "execute X" → the appropriate run command
- If the user says "install X" → npm install X or pip install X (infer from context)
- If the user says "show/list files" → ls -la
- If the user says "git commit" → git add -A && git commit -m "MESSAGE"
- If the user says "open/edit X" → cat X or vim X
- If the user says "delete X" → rm X (with confirmation)
- If the user says "go to/change directory X" → cd X
- If it's unclear or not a command, return: UNCLEAR: <reason>
- For dangerous commands (rm -rf, etc.), prefix with: DANGEROUS: <command>`;

const COLORS = {
  confirm:  '#28c840',
  warning:  '#FF7000',
  unclear:  '#EF4444',
  bg:       '#0c0c12',
  text:     '#FFFFFF',
  textDim:  '#A0A0A0',
};

class VoiceCommandProcessor {
  constructor(windowManager, getTermWsFn) {
    this._wm = windowManager;
    this._getTermWs = getTermWsFn;
    this._pendingDangerous = null;
    this._activeWindow = null;
    this._autoCloseTimer = null;
    this._autoExecTimer = null;
  }

  // ── Main entry point ──────────────────────────────────────────

  async processTranscription(text) {
    if (!text || !text.trim()) return;

    const trimmed = text.trim();
    console.log('[VoiceCmd] Processing:', trimmed);

    let command;
    try {
      command = await this._askMistral(trimmed);
    } catch (err) {
      console.error('[VoiceCmd] Mistral error:', err);
      this._showCommandWindow('Error: ' + err.message, 'unclear');
      return;
    }

    if (!command || !command.trim()) {
      this._showCommandWindow('No command parsed from input.', 'unclear');
      return;
    }

    command = command.trim();
    console.log('[VoiceCmd] Parsed command:', command);

    if (command.startsWith('UNCLEAR:')) {
      const reason = command.slice('UNCLEAR:'.length).trim();
      this._showCommandWindow(reason, 'unclear');
    } else if (command.startsWith('DANGEROUS:')) {
      const dangerousCmd = command.slice('DANGEROUS:'.length).trim();
      this._pendingDangerous = dangerousCmd;
      this._showCommandWindow(dangerousCmd, 'warning');
    } else {
      this._showCommandWindow(command, 'confirm');
      this._autoExecTimer = setTimeout(() => {
        this._executeCommand(command);
      }, 1500);
    }
  }

  // ── Mistral chat API call ─────────────────────────────────────

  async _askMistral(userText) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
        max_tokens: 150,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      throw new Error(`Chat API returned ${res.status}`);
    }

    const data = await res.json();

    // Standard Mistral API response format
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message?.content || '';
    }
    // Fallback: direct response field
    if (data.response) {
      return data.response;
    }
    // Fallback: content field
    if (data.content) {
      return data.content;
    }

    throw new Error('Unexpected chat response format');
  }

  // ── Command window display ────────────────────────────────────

  _showCommandWindow(command, type) {
    // Close any existing command window
    this._closeActiveWindow();

    const borderColor = type === 'confirm' ? COLORS.confirm
                      : type === 'warning' ? COLORS.warning
                      : COLORS.unclear;

    const title = type === 'confirm' ? 'VOICE CMD'
                : type === 'warning' ? 'WARNING'
                : 'HELP';

    const win = this._wm.createWindow({
      title:    title,
      width:    0.4,
      height:   0.12,
      position: [0, 1.75, -0.7],
      closable: true,
      content:  (ctx, w, h) => {
        this._drawCommandContent(ctx, w, h, command, type, borderColor);
      },
    });

    this._activeWindow = win;

    // Auto-close after 4 seconds
    this._autoCloseTimer = setTimeout(() => {
      this._closeActiveWindow();
    }, 4000);
  }

  _drawCommandContent(ctx, w, h, command, type, borderColor) {
    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // Colored border accent (top line)
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, w, 4);

    // Side accents
    ctx.fillStyle = borderColor;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w - 3, 0, 3, h);
    ctx.globalAlpha = 1.0;

    // Command text — monospace style
    ctx.font = '18px monospace';
    ctx.fillStyle = COLORS.text;

    const padding = 16;
    const maxTextW = w - padding * 2;

    if (type === 'unclear') {
      // "Not understood" label
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = COLORS.unclear;
      ctx.fillText('NOT A COMMAND', padding, 30);

      // Reason text
      ctx.font = '16px monospace';
      ctx.fillStyle = COLORS.textDim;
      const lines = this._wrapText(ctx, command, maxTextW);
      lines.forEach((line, i) => {
        if (i < 3) ctx.fillText(line, padding, 55 + i * 20);
      });
    } else if (type === 'warning') {
      // Warning label
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = COLORS.warning;
      ctx.fillText('DANGEROUS', padding, 28);

      // Command
      ctx.font = '16px monospace';
      ctx.fillStyle = COLORS.text;
      const truncated = command.length > 35 ? command.slice(0, 35) + '...' : command;
      ctx.fillText('> ' + truncated, padding, 52);

      // Instruction
      ctx.font = '12px monospace';
      ctx.fillStyle = COLORS.textDim;
      ctx.fillText('Pinch to confirm', padding, 74);
    } else {
      // Confirm type — show command with green accent
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = COLORS.confirm;
      ctx.fillText('EXECUTING', padding, 28);

      // Command
      ctx.font = '16px monospace';
      ctx.fillStyle = COLORS.text;
      const truncated = command.length > 35 ? command.slice(0, 35) + '...' : command;
      ctx.fillText('> ' + truncated, padding, 52);

      // Countdown hint
      ctx.font = '12px monospace';
      ctx.fillStyle = COLORS.textDim;
      ctx.fillText('Running in 1.5s...', padding, 74);
    }
  }

  _wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  // ── Execute command on terminal WebSocket ─────────────────────

  _executeCommand(command) {
    const ws = this._getTermWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[VoiceCmd] Terminal WebSocket not open');
      return;
    }

    // ttyd protocol: '0' prefix for input data
    const payload = new TextEncoder().encode('0' + command + '\r');
    ws.send(payload);
    console.log('[VoiceCmd] Sent to terminal:', command);
  }

  // ── Confirm a pending dangerous command ───────────────────────

  confirmDangerous() {
    if (!this._pendingDangerous) {
      console.warn('[VoiceCmd] No pending dangerous command');
      return;
    }

    const cmd = this._pendingDangerous;
    this._pendingDangerous = null;
    this._closeActiveWindow();
    this._executeCommand(cmd);
    console.log('[VoiceCmd] Dangerous command confirmed:', cmd);
  }

  // ── Cleanup helpers ───────────────────────────────────────────

  _closeActiveWindow() {
    if (this._autoCloseTimer) {
      clearTimeout(this._autoCloseTimer);
      this._autoCloseTimer = null;
    }
    if (this._autoExecTimer) {
      clearTimeout(this._autoExecTimer);
      this._autoExecTimer = null;
    }
    if (this._activeWindow && !this._activeWindow.closed) {
      this._activeWindow.close();
    }
    this._activeWindow = null;
  }

  get hasPendingDangerous() {
    return !!this._pendingDangerous;
  }
}

export { VoiceCommandProcessor };
