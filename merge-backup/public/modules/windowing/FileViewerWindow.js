// ═══════════════════════════════════════════════════════════════════
//  FileViewerWindow.js — Code Editor / Image Preview Window
// ═══════════════════════════════════════════════════════════════════
//
//  USAGE:
//    import { FileViewerWindow } from './FileViewerWindow.js';
//    const fileViewer = new FileViewerWindow(wm);
//    fileViewer.open({ filename: 'main.py', content: 'print("hello")', language: 'python' });
//    fileViewer.open({ filename: 'logo.png', content: 'data:image/png;base64,...', isImage: true });
//
// ═══════════════════════════════════════════════════════════════════

import { log } from '../core/logging.js';

class FileViewerWindow {
  /**
   * @param {WindowManager} windowManager
   */
  constructor(windowManager) {
    this.wm = windowManager;
    this._windows = [];
  }

  /**
   * Open a file viewer window.
   * @param {object} opts
   * @param {string} opts.filename   — File name (used as window title)
   * @param {string} opts.content    — File text content OR data URL for images
   * @param {string} [opts.language] — Monaco language ID (auto-detected from extension if omitted)
   * @param {boolean} [opts.isImage] — Force image mode
   * @param {string} [opts.filePath] — Full file path for auto-refresh (defaults to filename)
   * @param {number[]} [opts.position] — [x, y, z] in meters
   * @param {number} [opts.width]    — Window width in meters
   * @param {number} [opts.height]   — Window height in meters
   * @returns {{ window: ManagedWindow, getContent: Function, setContent: Function }}
   */
  open(opts = {}) {
    const filename = opts.filename || 'untitled';
    const content = opts.content || '';
    const filePath = opts.filePath || filename;
    const isImage = opts.isImage || this._isImageFile(filename);
    const position = opts.position; // undefined = auto-layout by WindowManager
    const width = opts.width || 0.8;
    const height = opts.height || 0.6;

    if (isImage) {
      return this._openImageWindow(filename, content, position, width, height);
    } else {
      return this._openEditorWindow(filename, content, opts.language, position, width, height, filePath);
    }
  }

  // ── Image preview window ──────────────────────────────────────

  _openImageWindow(filename, src, position, width, height) {
    const img = new Image();
    let imageLoaded = false;

    const imgOpts = {
      title: filename,
      width,
      height,
      closable: true,
      content: (ctx, w, h) => {
        // Dark background for image preview
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, w, h);

        if (imageLoaded) {
          // Fit image within canvas maintaining aspect ratio
          const padding = 10;
          const maxW = w - padding * 2;
          const maxH = h - padding * 2;
          const scale = Math.min(maxW / img.width, maxH / img.height, 1);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const x = (w - drawW) / 2;
          const y = (h - drawH) / 2;

          // Checkerboard background for transparency
          const tileSize = 8;
          for (let ty = y; ty < y + drawH; ty += tileSize) {
            for (let tx = x; tx < x + drawW; tx += tileSize) {
              const col = ((Math.floor((tx - x) / tileSize) + Math.floor((ty - y) / tileSize)) % 2 === 0)
                ? '#ffffff' : '#cccccc';
              ctx.fillStyle = col;
              ctx.fillRect(tx, ty, Math.min(tileSize, x + drawW - tx), Math.min(tileSize, y + drawH - ty));
            }
          }

          ctx.drawImage(img, x, y, drawW, drawH);

          // Image dimensions label
          ctx.fillStyle = '#888';
          ctx.font = '12px monospace';
          ctx.fillText(`${img.width} × ${img.height}`, padding, h - padding);
        } else {
          ctx.fillStyle = '#888';
          ctx.font = '16px monospace';
          ctx.fillText('Loading image...', 20, 30);
        }
      }
    };
    if (position) imgOpts.position = position;
    const win = this.wm.createWindow(imgOpts);

    img.onload = () => {
      imageLoaded = true;
      win.setContent(win.contentDrawFn); // redraw
    };
    img.onerror = () => {
      win.setContent((ctx, w, h) => {
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ff4444';
        ctx.font = '16px monospace';
        ctx.fillText('Failed to load image', 20, 30);
      });
    };
    img.src = src;

    const handle = { window: win, getContent: () => src, setContent: () => {} };
    this._windows.push(handle);
    return handle;
  }

  // ── Monaco editor window ──────────────────────────────────────

  _openEditorWindow(filename, content, language, position, width, height, filePath) {
    const lang = language || this._detectLanguage(filename);
    const refreshPath = filePath || filename;

    const state = {
      content: content,
      scrollLine: 0,
      cursorLine: 0,
      cursorCol: 0,
      language: lang,
      cursorVisible: true,
      cursorBlinkTimer: 0,
      scrollAccum: 0,
      highlightLine: -1,
      highlightFade: 0,
    };

    // Syntax highlighting colors (VS Code dark theme)
    const theme = {
      bg:         '#1e1e1e',
      fg:         '#d4d4d4',
      lineNum:    '#858585',
      lineNumBg:  '#1e1e1e',
      selection:  '#264f78',
      cursor:     '#aeafad',
      keyword:    '#569cd6',
      string:     '#ce9178',
      comment:    '#6a9955',
      number:     '#b5cea8',
      function:   '#dcdcaa',
      type:       '#4ec9b0',
      variable:   '#9cdcfe',
      operator:   '#d4d4d4',
      punctuation:'#d4d4d4',
      gutter:     '#252526',
      activeLine: '#2a2d2e',
    };

    // Simple tokenizer for syntax highlighting
    const tokenize = (line, lang) => {
      const tokens = [];
      const keywords = this._getKeywords(lang);
      const commentStart = this._getCommentStart(lang);

      let i = 0;
      while (i < line.length) {
        // Comment
        if (commentStart && line.substring(i).startsWith(commentStart)) {
          tokens.push({ text: line.substring(i), color: theme.comment });
          break;
        }

        // String (double or single quote)
        if (line[i] === '"' || line[i] === "'") {
          const quote = line[i];
          let j = i + 1;
          while (j < line.length && line[j] !== quote) {
            if (line[j] === '\\') j++;
            j++;
          }
          j = Math.min(j + 1, line.length);
          tokens.push({ text: line.substring(i, j), color: theme.string });
          i = j;
          continue;
        }

        // Template literal
        if (line[i] === '`') {
          let j = i + 1;
          while (j < line.length && line[j] !== '`') {
            if (line[j] === '\\') j++;
            j++;
          }
          j = Math.min(j + 1, line.length);
          tokens.push({ text: line.substring(i, j), color: theme.string });
          i = j;
          continue;
        }

        // Number
        if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>!&|^~%]/.test(line[i - 1]))) {
          let j = i;
          while (j < line.length && /[0-9.xXa-fA-F_]/.test(line[j])) j++;
          tokens.push({ text: line.substring(i, j), color: theme.number });
          i = j;
          continue;
        }

        // Word (keyword / identifier / function)
        if (/[a-zA-Z_$]/.test(line[i])) {
          let j = i;
          while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
          const word = line.substring(i, j);
          let color = theme.fg;
          if (keywords.has(word)) {
            color = theme.keyword;
          } else if (j < line.length && line[j] === '(') {
            color = theme.function;
          } else if (word[0] === word[0].toUpperCase() && /[a-z]/.test(word.slice(1))) {
            color = theme.type;
          }
          tokens.push({ text: word, color });
          i = j;
          continue;
        }

        // Operators / punctuation
        if (/[+\-*/%=<>!&|^~?:]/.test(line[i])) {
          tokens.push({ text: line[i], color: theme.operator });
          i++;
          continue;
        }

        // Other character
        tokens.push({ text: line[i], color: theme.fg });
        i++;
      }

      return tokens;
    };

    // Layout constants (shared between draw and interaction)
    const FONT_SIZE = 13;
    const LINE_HEIGHT = 16;
    const GUTTER_WIDTH = 45;
    const PADDING = 5;
    const STATUS_H = 18;

    const editorOpts = {
      title: `${filename} — ${lang}`,
      width,
      height,
      closable: true,
      content: (ctx, w, h) => {
        const lines = state.content.split('\n');
        const visibleLines = Math.floor((h - PADDING * 2 - STATUS_H) / LINE_HEIGHT);

        // Background
        ctx.fillStyle = theme.bg;
        ctx.fillRect(0, 0, w, h);

        // Gutter background
        ctx.fillStyle = theme.gutter;
        ctx.fillRect(0, 0, GUTTER_WIDTH, h - STATUS_H);

        // Gutter separator
        ctx.fillStyle = '#333';
        ctx.fillRect(GUTTER_WIDTH - 1, 0, 1, h - STATUS_H);

        ctx.font = `${FONT_SIZE}px "Cascadia Code", "Fira Code", "Consolas", "Courier New", monospace`;
        ctx.textBaseline = 'top';

        const startLine = state.scrollLine;
        const endLine = Math.min(startLine + visibleLines, lines.length);

        // Measure character width for cursor positioning
        const charWidth = ctx.measureText('M').width;

        for (let i = startLine; i < endLine; i++) {
          const y = PADDING + (i - startLine) * LINE_HEIGHT;

          // Highlight flash on tapped line
          if (i === state.highlightLine && state.highlightFade > 0) {
            ctx.fillStyle = `rgba(38, 79, 120, ${state.highlightFade})`;
            ctx.fillRect(GUTTER_WIDTH, y - 1, w - GUTTER_WIDTH, LINE_HEIGHT);
          }

          // Active line highlight
          if (i === state.cursorLine) {
            ctx.fillStyle = theme.activeLine;
            ctx.fillRect(GUTTER_WIDTH, y - 1, w - GUTTER_WIDTH, LINE_HEIGHT);
          }

          // Line number
          ctx.fillStyle = i === state.cursorLine ? '#c6c6c6' : theme.lineNum;
          const lineNumStr = String(i + 1);
          ctx.fillText(lineNumStr, GUTTER_WIDTH - 8 - ctx.measureText(lineNumStr).width, y);

          // Syntax-highlighted code
          const tokens = tokenize(lines[i], lang);
          let x = GUTTER_WIDTH + PADDING;
          for (const token of tokens) {
            ctx.fillStyle = token.color;
            ctx.fillText(token.text, x, y);
            x += ctx.measureText(token.text).width;
          }

          // Blinking cursor
          if (i === state.cursorLine && state.cursorVisible) {
            const cursorX = GUTTER_WIDTH + PADDING + charWidth * state.cursorCol;
            ctx.fillStyle = theme.cursor;
            ctx.fillRect(cursorX, y, 2, LINE_HEIGHT - 2);
          }
        }

        // Scrollbar
        if (lines.length > visibleLines) {
          const scrollbarH = Math.max(20, (visibleLines / lines.length) * (h - STATUS_H));
          const scrollbarY = (state.scrollLine / Math.max(1, lines.length - visibleLines)) * (h - STATUS_H - scrollbarH);
          ctx.fillStyle = '#424242';
          ctx.fillRect(w - 10, 0, 10, h - STATUS_H);
          ctx.fillStyle = '#686868';
          ctx.fillRect(w - 8, scrollbarY, 6, scrollbarH);

          // Scroll indicators (arrows)
          if (state.scrollLine > 0) {
            ctx.fillStyle = '#888';
            ctx.font = '10px monospace';
            ctx.fillText('\u25B2', w - 9, 2);
          }
          if (state.scrollLine + visibleLines < lines.length) {
            ctx.fillStyle = '#888';
            ctx.font = '10px monospace';
            ctx.fillText('\u25BC', w - 9, h - STATUS_H - 12);
          }
        }

        // Status bar at bottom
        ctx.fillStyle = '#007acc';
        ctx.fillRect(0, h - STATUS_H, w, STATUS_H);
        ctx.fillStyle = '#fff';
        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`  Ln ${state.cursorLine + 1}, Col ${state.cursorCol + 1}`, 4, h - STATUS_H + 3);
        const modeText = lang;
        ctx.fillText(modeText, w - ctx.measureText(modeText).width - 12, h - STATUS_H + 3);
        const lineCount = `${lines.length} lines`;
        ctx.fillText(lineCount, w / 2 - ctx.measureText(lineCount).width / 2, h - STATUS_H + 3);
      }
    };
    if (position) editorOpts.position = position;
    const win = this.wm.createWindow(editorOpts);

    // ── Content interaction handler (scroll, cursor) ──
    const SCROLL_SENSITIVITY = 0.01; // meters per line

    // Helper to place cursor from a local-space hit point
    const placeCursorFromLocal = (localPoint) => {
      const contentW = win._contentW;
      const contentH = win._contentH;
      const canvasX = (localPoint.x / contentW + 0.5) * win.CANVAS_W;
      const canvasY = (0.5 - localPoint.y / contentH) * win.CANVAS_H;

      const line = Math.floor((canvasY - PADDING) / LINE_HEIGHT) + state.scrollLine;
      const lines = state.content.split('\n');
      const clampedLine = Math.max(0, Math.min(lines.length - 1, line));

      // Approximate char width for column calc
      const tmpCanvas = document.createElement('canvas');
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.font = `${FONT_SIZE}px "Cascadia Code", "Fira Code", "Consolas", "Courier New", monospace`;
      const charW = tmpCtx.measureText('M').width;
      const col = Math.max(0, Math.floor((canvasX - GUTTER_WIDTH - PADDING) / charW));
      const clampedCol = Math.min(col, (lines[clampedLine] || '').length);

      state.cursorLine = clampedLine;
      state.cursorCol = clampedCol;
      state.cursorVisible = true;
      state.cursorBlinkTimer = 0;

      // Auto-scroll to cursor
      const visibleLines = Math.floor((win.CANVAS_H - PADDING * 2 - STATUS_H) / LINE_HEIGHT);
      if (clampedLine < state.scrollLine) {
        state.scrollLine = clampedLine;
      } else if (clampedLine >= state.scrollLine + visibleLines) {
        state.scrollLine = clampedLine - visibleLines + 1;
      }
    };

    win.onContentInteraction = (data, phase, handIdx) => {
      if (phase === 'start') {
        state.scrollAccum = 0;
      } else if (phase === 'move' && data) {
        // data.y is the projected scroll delta along the window's up axis
        state.scrollAccum += data.y;
        const lineDelta = Math.round(state.scrollAccum / SCROLL_SENSITIVITY);
        if (lineDelta !== 0) {
          const lines = state.content.split('\n');
          const visibleLines = Math.floor((win.CANVAS_H - PADDING * 2 - STATUS_H) / LINE_HEIGHT);
          const maxScroll = Math.max(0, lines.length - visibleLines);
          state.scrollLine = Math.max(0, Math.min(maxScroll, state.scrollLine - lineDelta));
          state.scrollAccum -= lineDelta * SCROLL_SENSITIVITY;
          win.setContent(win.contentDrawFn);
        }
      } else if (phase === 'tap' && data) {
        placeCursorFromLocal(data);

        // Highlight flash
        state.highlightLine = state.cursorLine;
        state.highlightFade = 0.6;

        win.setContent(win.contentDrawFn);
      }
      // 'end' phase — no action needed
    };

    // ── Blinking cursor update (piggyback on ManagedWindow.update) ──
    const origUpdate = win.update.bind(win);
    let needsRedraw = false;
    win.update = (dt, elapsed) => {
      origUpdate(dt, elapsed);
      needsRedraw = false;

      // Cursor blink (toggle every 500ms)
      state.cursorBlinkTimer += dt;
      if (state.cursorBlinkTimer >= 0.5) {
        state.cursorBlinkTimer -= 0.5;
        state.cursorVisible = !state.cursorVisible;
        needsRedraw = true;
      }

      // Highlight fade
      if (state.highlightFade > 0) {
        state.highlightFade -= dt * 2;
        if (state.highlightFade <= 0) {
          state.highlightFade = 0;
          state.highlightLine = -1;
        }
        needsRedraw = true;
      }

      // Single redraw per frame max
      if (needsRedraw) {
        try {
          win._drawContentCanvas();
        } catch (e) {
          console.warn('FileViewer redraw error:', e);
        }
      }
    };

    const handle = {
      window: win,
      state: state,
      filename: filename,
      _refreshTimer: null,

      /** Get the current editor content */
      getContent() {
        return state.content;
      },

      /** Set new content and re-render (preserves scroll & cursor) */
      setContent(newContent, preservePosition = false) {
        const prevScroll = state.scrollLine;
        const prevCursorLine = state.cursorLine;
        const prevCursorCol = state.cursorCol;

        state.content = newContent;

        if (preservePosition) {
          // Clamp to new line count
          const lineCount = newContent.split('\n').length;
          state.scrollLine = Math.min(prevScroll, Math.max(0, lineCount - 1));
          state.cursorLine = Math.min(prevCursorLine, lineCount - 1);
          state.cursorCol = prevCursorCol;
        } else {
          state.scrollLine = 0;
          state.cursorLine = 0;
          state.cursorCol = 0;
        }
        win.setContent(win.contentDrawFn);
      },

      /** Scroll to a specific line */
      scrollTo(line) {
        state.scrollLine = Math.max(0, line);
        win.setContent(win.contentDrawFn);
      },

      /** Set cursor position and scroll to it */
      setCursor(line, col) {
        state.cursorLine = line;
        state.cursorCol = col || 0;
        // Auto-scroll to keep cursor visible
        const lines = state.content.split('\n');
        const visibleLines = Math.floor((win.CANVAS_H - PADDING * 2 - STATUS_H) / LINE_HEIGHT);
        if (line < state.scrollLine) {
          state.scrollLine = line;
        } else if (line >= state.scrollLine + visibleLines - 1) {
          state.scrollLine = line - visibleLines + 2;
        }
        win.setContent(win.contentDrawFn);
      },

      /** Highlight a range of lines */
      highlight(startLine, endLine) {
        state.cursorLine = startLine;
        handle.scrollTo(Math.max(0, startLine - 3));
      },

      /** Stop the auto-refresh polling */
      stopAutoRefresh() {
        if (this._refreshTimer) {
          clearInterval(this._refreshTimer);
          this._refreshTimer = null;
        }
      },
    };

    // ── Auto-refresh: poll file content every 2 seconds ──
    const REFRESH_INTERVAL_MS = 2000;
    handle._refreshTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/companion/files/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: refreshPath }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const newContent = data.content ?? '';
        // Only update if content actually changed
        if (newContent !== state.content) {
          handle.setContent(newContent, true);  // preserve scroll & cursor
          log(`[FileViewer] Auto-refreshed: ${refreshPath}`);
        }
      } catch (e) {
        // Silently ignore fetch errors (server down, etc.)
      }
    }, REFRESH_INTERVAL_MS);

    // Clean up interval when window is closed
    const origClose = win.close.bind(win);
    win.close = () => {
      handle.stopAutoRefresh();
      origClose();
    };

    this._windows.push(handle);
    return handle;
  }

  // ── Helpers ────────────────────────────────────────────────────

  _isImageFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext);
  }

  _detectLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', jsx: 'javascript', mjs: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'c', h: 'c',
      cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
      cs: 'csharp',
      html: 'html', htm: 'html',
      css: 'css', scss: 'scss', less: 'less',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml', yml: 'yaml',
      md: 'markdown',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      sql: 'sql',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      lua: 'lua',
      r: 'r',
      toml: 'toml',
      ini: 'ini',
      dockerfile: 'dockerfile',
    };
    return map[ext] || 'plaintext';
  }

  _getCommentStart(lang) {
    const map = {
      javascript: '//', typescript: '//', python: '#', ruby: '#',
      rust: '//', go: '//', java: '//', c: '//', cpp: '//',
      csharp: '//', swift: '//', kotlin: '//', php: '//',
      shell: '#', yaml: '#', toml: '#', r: '#', lua: '--',
    };
    return map[lang] || null;
  }

  _getKeywords(lang) {
    const kw = {
      javascript: 'break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield async await',
      typescript: 'break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let module namespace new null of package private protected public return static super switch this throw true try type typeof undefined var void while with yield async await',
      python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
      rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
      go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil',
      java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false',
      c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
      cpp: 'alignas alignof and and_eq asm auto bitand bitor bool break case catch char class compl const constexpr continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while',
      html: 'DOCTYPE html head body title meta link script style div span p a img input button form table tr td th ul ol li h1 h2 h3 h4 h5 h6 header footer nav section article aside main',
      css: 'color background display position margin padding border font width height top left right bottom float clear flex grid align justify content items',
      json: '',
      shell: 'if then else elif fi case esac for while until do done in function select time coproc',
      sql: 'SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE DROP ALTER TABLE INDEX VIEW JOIN LEFT RIGHT INNER OUTER ON AND OR NOT NULL IS IN LIKE BETWEEN GROUP BY ORDER HAVING LIMIT OFFSET UNION SET VALUES AS DISTINCT COUNT SUM AVG MIN MAX',
    };
    const str = kw[lang] || '';
    return new Set(str.split(/\s+/).filter(Boolean));
  }
}

export { FileViewerWindow };
