// ═══════════════════════════════════════════════════════════
//  scene-control.js — WebSocket listener for MCP scene commands
//  Receives commands from the MCP server (via web server relay)
//  and dispatches them to GitTree, Bubbles, WindowManager, etc.
// ═══════════════════════════════════════════════════════════

import { log } from './core/logging.js';

let ws = null;
let reconnectTimer = null;
let handlers = {};

/**
 * Initialize the scene-control WebSocket connection.
 * @param {object} modules - { gitTree, bubbleMgr, codeCity, wm }
 */
export function initSceneControl(modules) {
  handlers = modules;
  _connect();
}

function _connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws/scene-control`;
  log(`[SCENE-CTRL] Connecting to ${url}`);

  ws = new WebSocket(url);

  ws.onopen = () => {
    log('[SCENE-CTRL] Connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (evt) => {
    try {
      const cmd = JSON.parse(evt.data);
      _dispatch(cmd);
    } catch (e) {
      log(`[SCENE-CTRL] Bad message: ${e.message}`);
    }
  };

  ws.onclose = () => {
    log('[SCENE-CTRL] Disconnected, reconnecting in 3s...');
    reconnectTimer = setTimeout(_connect, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function _dispatch(cmd) {
  const { action } = cmd;
  if (!action) return;
  log(`[SCENE-CTRL] Action: ${action}`);

  const { gitTree, bubbleMgr, codeCity, wm, streamScreen, livePreview, fileViewer } = handlers;

  switch (action) {
    // ── Git tree commands ──
    case 'load_git_tree':
      if (gitTree) gitTree.loadHistory();
      break;

    case 'highlight_commit':
      if (gitTree) gitTree.highlightCommit(cmd.commit, cmd.color);
      break;

    case 'highlight_branch':
      if (gitTree) gitTree.highlightBranch(cmd.branch, cmd.color);
      break;

    case 'show_commit_details':
      if (gitTree) gitTree.showCommitDetails(cmd.commit);
      break;

    case 'navigate_to_commit':
      if (gitTree) gitTree.navigateToCommit(cmd.commit);
      break;

    case 'clear_highlights':
      if (gitTree) gitTree.clearHighlights();
      break;

    case 'toggle_git_tree':
      if (gitTree) gitTree.toggle();
      break;

    case 'show_git_tree':
      if (gitTree) gitTree.show();
      break;

    case 'hide_git_tree':
      if (gitTree) gitTree.hide();
      break;

    // ── File / window commands ──
    case 'open_file':
      if (bubbleMgr) bubbleMgr.openFile(cmd.path);
      break;

    case 'show_window':
      if (wm) {
        const winOpts = {
          title: cmd.title || 'MCP Window',
          width: 0.5,
          height: 0.4,
          canvasWidth: 512,
          canvasHeight: 400,
          closable: true,
        };
        if (cmd.position) winOpts.position = cmd.position;
        const win = wm.createWindow(winOpts);
        win._openedByAgent = true; // Tag as agent-opened for hide_window
        // Draw content text
        const ctx = win.contentCtx;
        ctx.fillStyle = '#0c0c12';
        ctx.fillRect(0, 0, win.CANVAS_W, win.CANVAS_H);
        ctx.fillStyle = '#e0e0e0';
        ctx.font = '14px monospace';
        const lines = (cmd.content || '').split('\n');
        for (let i = 0; i < lines.length && i < 25; i++) {
          ctx.fillText(lines[i], 8, 20 + i * 16);
        }
        win.markContentDirty();
      }
      break;

    case 'notification':
      _showNotification(cmd.message, cmd.duration, cmd.color);
      break;

    case 'terminal_command':
      _runTerminalCommand(cmd.command);
      break;

    case 'show_terminal':
      _showTerminalWindow(cmd.title, cmd.position);
      break;

    // ── Window management commands ──
    case 'list_windows':
      _handleListWindows();
      break;

    case 'hide_window':
      _handleHideWindow(cmd.windowId);
      break;

    // ── Preview commands ──
    case 'refresh_preview':
      _handleRefreshPreview();
      break;

    // ── File visualization commands ──
    case 'browse_folder':
      if (bubbleMgr) {
        bubbleMgr.loadFiles(cmd.path || '.');
        if (!bubbleMgr._explorerVisible) bubbleMgr.show();
      }
      break;

    case 'highlight_file':
      if (bubbleMgr) bubbleMgr.highlightFile(cmd.path, cmd.color, cmd.pulse);
      break;

    case 'file_change':
      if (bubbleMgr) bubbleMgr.showFileChange(cmd.path, cmd.action, cmd.summary);
      _showNotification(
        `${(cmd.action || 'edit').toUpperCase()}: ${cmd.path}${cmd.summary ? ' — ' + cmd.summary : ''}`,
        3,
        cmd.action === 'create' ? '#22C55E' : cmd.action === 'delete' ? '#EF4444' : '#FF7000'
      );
      break;

    case 'arrange_files':
      if (bubbleMgr) {
        if (!bubbleMgr._explorerVisible) bubbleMgr.show();
        bubbleMgr.arrangeFiles(cmd.layout, cmd.groupBy, cmd.sortBy);
      }
      break;

    case 'move_file_bubble':
      if (bubbleMgr) bubbleMgr.moveFileBubble(cmd.path, cmd.position);
      break;

    // ── Screen & preview stream commands ──
    case 'open_screen_stream':
      if (streamScreen) streamScreen.open({
        url: cmd.url,
        position: cmd.position,
        width: cmd.width,
        height: cmd.height,
      });
      break;

    case 'close_screen_stream':
      if (streamScreen) streamScreen.close();
      break;

    case 'open_live_preview':
      console.log(`[SCENE-CTRL] open_live_preview: port=${cmd.port}, hasLivePreview=${!!livePreview}`);
      if (livePreview && cmd.port) livePreview.openPreview(cmd.port);
      break;

    // ── File viewer commands ──
    case 'open_file_viewer':
      if (fileViewer) {
        fileViewer.open({
          filename: cmd.filename,
          content: cmd.content,
          language: cmd.language,
          isImage: cmd.isImage,
          filePath: cmd.filePath || cmd.filename,
          position: cmd.position,
          width: cmd.width,
          height: cmd.height,
        });
      }
      break;

    case 'toggle_explorer':
      if (handlers.toggleExplorer) handlers.toggleExplorer();
      break;

    default:
      log(`[SCENE-CTRL] Unknown action: ${action}`);
  }

  // Send ack back to server
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ ack: action, timestamp: Date.now() }));
  }
}

function _showNotification(message, duration = 3, color = '#FF7000') {
  const { wm } = handlers;
  if (!wm) return;

  const win = wm.createWindow({
    title: 'NOTIFICATION',
    width: 0.4,
    height: 0.08,
    position: [0, 1.8, -0.5],
    canvasWidth: 400,
    canvasHeight: 80,
    closable: true,
  });
  win._openedByAgent = true;

  const ctx = win.contentCtx;
  ctx.fillStyle = '#0c0c12';
  ctx.fillRect(0, 0, 400, 80);
  ctx.fillStyle = color;
  ctx.font = 'bold 18px monospace';
  ctx.fillText(message || '', 10, 45);
  win.markContentDirty();

  // Auto-close after duration
  setTimeout(() => {
    if (!win.closed) win.close();
  }, (duration || 3) * 1000);
}

async function _runTerminalCommand(command) {
  if (!command) return;
  log(`[SCENE-CTRL] *** TERMINAL_COMMAND received: ${command}`);
  console.warn(`[SCENE-CTRL] *** TERMINAL_COMMAND: ${command}`); // ensure it shows in Quest console
  try {
    // Send command to vibe-terminal via ttyd WebSocket (NOT companion container)
    log(`[SCENE-CTRL] Calling /api/terminal/exec...`);
    const resp = await fetch(`/api/terminal/exec?command=${encodeURIComponent(command)}`, {
      method: 'POST',
    });
    const data = await resp.json();
    if (!resp.ok) {
      log(`[SCENE-CTRL] Terminal exec FAILED: status=${resp.status} error=${data.error}`);
      console.error(`[SCENE-CTRL] Terminal exec FAILED:`, data);
    } else {
      log(`[SCENE-CTRL] Terminal exec SUCCESS: ${command}`);
      log(`[SCENE-CTRL] Terminal output: ${(data.output || '').slice(0, 200)}`);
      console.log(`[SCENE-CTRL] Terminal exec response:`, data);
    }
  } catch (e) {
    log(`[SCENE-CTRL] Terminal command EXCEPTION: ${e.message}`);
    console.error(`[SCENE-CTRL] Terminal command EXCEPTION:`, e);
  }
}

// ── Show terminal window (iframe to ttyd) ──

function _showTerminalWindow(title, position) {
  const { wm } = handlers;
  if (!wm) return;

  const win = wm.createWindow({
    title: title || 'Terminal Output',
    width: 0.7,
    height: 0.5,
    position: position || [0.5, 1.3, -0.6],
    canvasWidth: 800,
    canvasHeight: 500,
    closable: true,
  });
  win._openedByAgent = true;

  const ctx = win.contentCtx;
  ctx.fillStyle = '#0c0c12';
  ctx.fillRect(0, 0, win.CANVAS_W, win.CANVAS_H);
  ctx.fillStyle = '#FF7000';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('Terminal — live output', 12, 28);
  ctx.fillStyle = '#888';
  ctx.font = '13px monospace';
  ctx.fillText('Connect to /terminal/ for full interactive session', 12, 52);
  win.markContentDirty();
}

// ── Window management ──

function _handleListWindows() {
  const { wm } = handlers;
  if (!wm) return;

  const windowList = wm.windows
    .filter(w => !w.closed)
    .map((w, i) => ({
      id: i,
      title: w.title || 'Untitled',
      openedByAgent: !!w._openedByAgent,
      minimized: !!w.minimized,
    }));

  log(`[SCENE-CTRL] Windows: ${JSON.stringify(windowList)}`);

  // Send the list back to the server so MCP gets it
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ ack: 'list_windows', windows: windowList, timestamp: Date.now() }));
  }
}

function _handleHideWindow(windowId) {
  const { wm } = handlers;
  if (!wm) return;

  const openWindows = wm.windows.filter(w => !w.closed);
  const win = openWindows[windowId];

  if (!win) {
    log(`[SCENE-CTRL] hide_window: no window with id ${windowId}`);
    return;
  }

  // Only auto-hide if the window was opened by the agent
  if (win._openedByAgent) {
    win.close();
    log(`[SCENE-CTRL] Closed agent window: ${win.title}`);
  } else {
    // User-opened window — show a notification instead of closing
    log(`[SCENE-CTRL] Window "${win.title}" was not opened by agent — skipping auto-hide`);
    _showNotification(`Cannot auto-hide "${win.title}" — user-opened window`, 3, '#FF4444');
  }
}

// ── Preview refresh ──

async function _handleRefreshPreview() {
  const { livePreview } = handlers;

  // Ask the server to reload the Puppeteer page
  try {
    await fetch('/api/devserver/refresh-preview', { method: 'POST' });
    log('[SCENE-CTRL] Preview refresh requested');
  } catch (e) {
    log(`[SCENE-CTRL] Preview refresh failed: ${e.message}`);
  }

  // If livePreview is active, notify
  if (livePreview && livePreview._port) {
    _showNotification('Preview refreshed', 2, '#00E676');
  }
}
