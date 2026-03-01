// MCP server config validation tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

describe('MCP Server Configuration', () => {
  it('mcp-server/server.py exists', () => {
    assert.ok(existsSync(join(rootDir, 'mcp-server', 'server.py')));
  });

  it('server.py imports FastMCP correctly', () => {
    const code = readFileSync(join(rootDir, 'mcp-server', 'server.py'), 'utf8');
    assert.match(code, /from mcp\.server\.fastmcp import FastMCP/);
  });

  it('server.py defines expected git tools', () => {
    const code = readFileSync(join(rootDir, 'mcp-server', 'server.py'), 'utf8');
    const expectedTools = [
      'git_log', 'git_branches', 'git_current_branch', 'git_diff',
      'git_show_commit', 'git_blame', 'git_file_history', 'git_status',
    ];
    for (const tool of expectedTools) {
      assert.match(code, new RegExp(`def ${tool}\\(`), `Missing tool: ${tool}`);
    }
  });

  it('server.py defines expected scene control tools', () => {
    const code = readFileSync(join(rootDir, 'mcp-server', 'server.py'), 'utf8');
    const expectedTools = [
      'scene_load_git_tree', 'scene_highlight_commit', 'scene_highlight_branch',
      'scene_show_commit_details', 'scene_show_diff_window', 'scene_navigate_to_commit',
      'scene_clear_highlights', 'scene_open_file', 'scene_show_window',
      'scene_show_notification', 'scene_run_terminal_command',
    ];
    for (const tool of expectedTools) {
      assert.match(code, new RegExp(`def ${tool}\\(`), `Missing tool: ${tool}`);
    }
  });

  it('server.py uses @mcp.tool() decorator on all tools', () => {
    const code = readFileSync(join(rootDir, 'mcp-server', 'server.py'), 'utf8');
    const toolDefs = code.match(/def (git_|scene_)\w+/g) || [];
    const decorators = code.match(/@mcp\.tool\(\)/g) || [];
    assert.equal(decorators.length, toolDefs.length,
      `Expected ${toolDefs.length} @mcp.tool() decorators, found ${decorators.length}`);
  });

  it('server.py sends scene commands to WEB_URL/api/scene-control', () => {
    const code = readFileSync(join(rootDir, 'mcp-server', 'server.py'), 'utf8');
    assert.match(code, /WEB_URL.*api\/scene-control/);
  });

  it('server.py reads VIBE_WORKSPACE and VIBE_WEB_URL env vars', () => {
    const code = readFileSync(join(rootDir, 'mcp-server', 'server.py'), 'utf8');
    assert.match(code, /VIBE_WORKSPACE/);
    assert.match(code, /VIBE_WEB_URL/);
  });

  it('workspace .vibe/config.toml exists and has correct format', () => {
    const configPath = join(rootDir, 'workspace', '.vibe', 'config.toml');
    assert.ok(existsSync(configPath), 'workspace/.vibe/config.toml should exist');

    const content = readFileSync(configPath, 'utf8');
    // Check providers section
    assert.match(content, /\[\[providers\]\]/, 'Should have [[providers]] section');
    assert.match(content, /name = "mistral"/, 'Provider name should be mistral');
    assert.match(content, /api_base = "http:\/\/web:3001\/mistral-proxy\/v1"/, 'Should proxy through web server');
    assert.match(content, /backend = "generic"/, 'Backend should be generic (not mistral — HTTP proxy)');

    // Check MCP server section
    assert.match(content, /\[\[mcp_servers\]\]/, 'Should have [[mcp_servers]] section');
    assert.match(content, /name = "vibe_ar"/, 'MCP server name should be vibe_ar');
    assert.match(content, /transport = "stdio"/, 'Transport should be stdio');
    assert.match(content, /command = "python"/, 'Command should be python');
    assert.match(content, /\/opt\/mcp-server\/server\.py/, 'Should point to MCP server script');
  });
});

describe('Dockerfile Configuration', () => {
  it('Dockerfile exists', () => {
    assert.ok(existsSync(join(rootDir, 'Dockerfile')));
  });

  it('Dockerfile installs mistral-vibe', () => {
    const df = readFileSync(join(rootDir, 'Dockerfile'), 'utf8');
    assert.match(df, /mistral-vibe/);
  });

  it('Dockerfile copies MCP server', () => {
    const df = readFileSync(join(rootDir, 'Dockerfile'), 'utf8');
    assert.match(df, /COPY mcp-server \/opt\/mcp-server/);
  });

  it('Dockerfile sets VIBE_HOME env var', () => {
    const df = readFileSync(join(rootDir, 'Dockerfile'), 'utf8');
    assert.match(df, /ENV VIBE_HOME/);
  });

  it('Dockerfile pre-trusts /workspace', () => {
    const df = readFileSync(join(rootDir, 'Dockerfile'), 'utf8');
    assert.match(df, /trusted_folders\.toml/);
    assert.match(df, /\/workspace/);
  });

  it('Dockerfile creates entrypoint that copies config on startup', () => {
    const df = readFileSync(join(rootDir, 'Dockerfile'), 'utf8');
    assert.match(df, /entrypoint\.sh/);
    assert.match(df, /ENTRYPOINT/);
  });
});

describe('Docker Compose Configuration', () => {
  it('docker-compose.yml exists', () => {
    assert.ok(existsSync(join(rootDir, 'docker-compose.yml')));
  });

  it('docker-compose.yml has all 4 services', () => {
    const dc = readFileSync(join(rootDir, 'docker-compose.yml'), 'utf8');
    assert.match(dc, /vibe-terminal:/);
    assert.match(dc, /web:/);
    assert.match(dc, /companion:/);
    assert.match(dc, /code-city-server:/);
  });

  it('docker-compose.yml passes MISTRAL_API_KEY to vibe-terminal', () => {
    const dc = readFileSync(join(rootDir, 'docker-compose.yml'), 'utf8');
    assert.match(dc, /MISTRAL_API_KEY/);
  });

  it('docker-compose.yml sets VIBE_HOME for vibe-terminal', () => {
    const dc = readFileSync(join(rootDir, 'docker-compose.yml'), 'utf8');
    assert.match(dc, /VIBE_HOME/);
  });

  it('docker-compose.yml mounts workspace volume', () => {
    const dc = readFileSync(join(rootDir, 'docker-compose.yml'), 'utf8');
    assert.match(dc, /\.\/workspace:\/workspace/);
  });

  it('web service depends on all backend services', () => {
    const dc = readFileSync(join(rootDir, 'docker-compose.yml'), 'utf8');
    assert.match(dc, /depends_on/);
    assert.match(dc, /vibe-terminal/);
    assert.match(dc, /companion/);
    assert.match(dc, /code-city-server/);
  });
});
