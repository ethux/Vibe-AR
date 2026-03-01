// ═══════════════════════════════════════════════════════════
//  scene-control.js — WebSocket listener for MCP scene commands
//  Receives commands from the MCP server (via web server relay)
//  and dispatches them to GitTree, Bubbles, WindowManager, etc.
// ═══════════════════════════════════════════════════════════

import { log } from './logging.js';

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

    // ── File visualization commands ──
    case 'browse_folder':
      if (bubbleMgr) bubbleMgr.loadFiles(cmd.path || '.');
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

  const ctx = win.contentCtx;
  ctx.fillStyle = '#0c0c12';
  ctx.fillRect(0, 0, 400, 80);
  ctx.fillStyle = color;
  ctx.font = 'bold 18px monospace';
  ctx.fillText(message || '', 10, 45);
  win.markContentDirty();

  // Auto-close after duration
  setTimeout(() => {
    if (!win.closed) wm.closeWindow(win);
  }, (duration || 3) * 1000);
}

async function _runTerminalCommand(command) {
  if (!command) return;
  try {
    await fetch(`/api/companion/terminal/run?command=${encodeURIComponent(command)}&cwd=.`, {
      method: 'POST',
    });
  } catch (e) {
    log(`[SCENE-CTRL] Terminal command failed: ${e.message}`);
  }
}
