// ═══════════════════════════════════════════════════════════════════
//  PixelArt.js — Pixel Art Utilities for WebXR AR Window Manager
// ═══════════════════════════════════════════════════════════════════

const PixelArt = {

  // Mistral palette with Win95 structure
  ORANGE_LIGHT:  '#FFB347',
  ORANGE:        '#F97316',
  ORANGE_DARK:   '#C2410C',
  ORANGE_SHADOW: '#7C2D12',
  BLACK:         '#000000',
  DARK_BG:       '#0A0A0A',
  BORDER_BG:     '#111111',
  WHITE:         '#FFFFFF',
  SILVER:        '#C0C0C0',
  DARK_GRAY:     '#808080',
  SHADOW:        '#404040',
  BTN_FACE:      '#C0C0C0',
  BTN_HIGHLIGHT: '#DFDFDF',
  BTN_SHADOW:    '#808080',

  // Title bar colors (Mistral orange gradient)
  TITLE_ACTIVE:    '#E65100',
  TITLE_ACTIVE_LT: '#FF7000',
  TITLE_INACTIVE:  '#808080',

  // Win95 compatibility aliases
  TITLE_BLUE:    '#E65100',   // maps to Mistral orange
  TITLE_BLUE_LT: '#FF7000',
  TITLE_GRAY:    '#808080',

  /**
   * Draw a single "fat pixel" on a canvas context.
   * pixelSize = how many real pixels per "art pixel"
   */
  drawPixel(ctx, px, py, pixelSize, color) {
    ctx.fillStyle = color;
    ctx.fillRect(px * pixelSize, py * pixelSize, pixelSize, pixelSize);
  },

  /**
   * Draw a full sprite from a 2D array of color indices.
   * palette = ['transparent', '#F97316', '#C2410C', ...]
   * grid[row][col] = palette index (0 = skip/transparent)
   */
  drawSprite(ctx, grid, ox, oy, pixelSize, palette) {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const idx = grid[r][c];
        if (idx === 0) continue; // transparent
        ctx.fillStyle = palette[idx];
        ctx.fillRect(
          ox + c * pixelSize,
          oy + r * pixelSize,
          pixelSize, pixelSize
        );
      }
    }
  },

  /**
   * Fill a solid rectangle (no motif/pattern, just flat color).
   */
  fillSolidBorder(ctx, x, y, w, h, color) {
    ctx.fillStyle = color || this.SILVER;
    ctx.fillRect(x, y, w, h);
  },

  /**
   * Draw a pixel-art title text. Each character is 5×7 art-pixels.
   * Renders blocky monospace text — no font loading needed.
   */
  drawPixelText(ctx, text, x, y, pixelSize, color) {
    // Compact 5×7 pixel font glyphs (only uppercase + digits + common punctuation)
    const glyphs = this._getGlyphs();
    ctx.fillStyle = color;
    let cursorX = x;
    for (const ch of text.toUpperCase()) {
      const glyph = glyphs[ch];
      if (glyph) {
        for (let r = 0; r < glyph.length; r++) {
          for (let c = 0; c < glyph[r].length; c++) {
            if (glyph[r][c]) {
              ctx.fillRect(
                cursorX + c * pixelSize,
                y + r * pixelSize,
                pixelSize, pixelSize
              );
            }
          }
        }
      }
      cursorX += (glyph ? glyph[0].length + 1 : 3) * pixelSize;
    }
  },

  /** Measure pixel text width in real pixels */
  measurePixelText(text, pixelSize) {
    const glyphs = this._getGlyphs();
    let w = 0;
    for (const ch of text.toUpperCase()) {
      const g = glyphs[ch];
      w += (g ? g[0].length + 1 : 3) * pixelSize;
    }
    return w - pixelSize; // remove trailing gap
  },

  /**
   * 5×7 pixel font for A-Z, 0-9, and a few symbols.
   * Each glyph is an array of rows, each row an array of 0/1.
   */
  _getGlyphs() {
    if (this._glyphCache) return this._glyphCache;
    // prettier-ignore
    this._glyphCache = {
      'A': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'B': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
      'C': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
      'D': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
      'E': [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
      'F': [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
      'G': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'H': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'I': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
      'J': [[0,0,1,1,1],[0,0,0,1,0],[0,0,0,1,0],[0,0,0,1,0],[1,0,0,1,0],[1,0,0,1,0],[0,1,1,0,0]],
      'K': [[1,0,0,0,1],[1,0,0,1,0],[1,0,1,0,0],[1,1,0,0,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
      'L': [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
      'M': [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'N': [[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'O': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'P': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
      'Q': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,0,1,0],[0,1,1,0,1]],
      'R': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
      'S': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'T': [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
      'U': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'V': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,1,0,1,0],[0,0,1,0,0]],
      'W': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,1,0,1],[1,1,0,1,1],[1,0,0,0,1]],
      'X': [[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,1,0,1,0],[1,0,0,0,1],[1,0,0,0,1]],
      'Y': [[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
      'Z': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
      '0': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,1,1],[1,0,1,0,1],[1,1,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '1': [[0,0,1,0,0],[0,1,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0]],
      '2': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,1,1,1,1]],
      '3': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,1,1,0],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '4': [[0,0,0,1,0],[0,0,1,1,0],[0,1,0,1,0],[1,0,0,1,0],[1,1,1,1,1],[0,0,0,1,0],[0,0,0,1,0]],
      '5': [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '6': [[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '7': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
      '8': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '9': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0]],
      ' ': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
      '.': [[0],[0],[0],[0],[0],[0],[1]],
      ':': [[0],[0],[1],[0],[1],[0],[0]],
      '-': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[1,1,1,1,1],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
      '_': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[1,1,1,1,1]],
      '!': [[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,0,0],[0,1,0]],
      '?': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,0,0,0],[0,0,1,0,0]],
      '/': [[0,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
    };
    return this._glyphCache;
  },

  /**
   * Draw a 3×3 pixel "X" cross for the close button.
   * Returns a canvas.
   */
  makeCloseIcon(pixelSize, color, bgColor) {
    const size = 3 * pixelSize;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.fillStyle = color;
    // X pattern: corners + center
    const ps = pixelSize;
    ctx.fillRect(0 * ps, 0 * ps, ps, ps);       // top-left
    ctx.fillRect(2 * ps, 0 * ps, ps, ps);       // top-right
    ctx.fillRect(1 * ps, 1 * ps, ps, ps);       // center
    ctx.fillRect(0 * ps, 2 * ps, ps, ps);       // bottom-left
    ctx.fillRect(2 * ps, 2 * ps, ps, ps);       // bottom-right
    return canvas;
  },

  /**
   * Draw a horizontal drag bar (3 pixels tall, variable width).
   * Returns a canvas.
   */
  makeDragBarIcon(widthPx, pixelSize, color, bgColor) {
    const artW = widthPx; // in art pixels
    const artH = 3;
    const canvas = document.createElement('canvas');
    canvas.width = artW * pixelSize;
    canvas.height = artH * pixelSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = color;
    // Three horizontal lines with gaps (grip pattern)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < artW; col++) {
        // Alternating dots pattern for grip feel
        if ((row + col) % 2 === 0) {
          ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize, pixelSize);
        }
      }
    }
    return canvas;
  },

  /**
   * Draw a pixel-art resize handle (small square with arrow pattern).
   * Returns a canvas.
   */
  makeResizeIcon(pixelSize, color) {
    // 5x5 diagonal resize indicator
    const size = 5;
    const canvas = document.createElement('canvas');
    canvas.width = size * pixelSize;
    canvas.height = size * pixelSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = color;
    // Diagonal lines pattern (bottom-right corner resize feel)
    const pattern = [
      [0,0,0,0,1],
      [0,0,0,0,0],
      [0,0,1,0,1],
      [0,0,0,0,0],
      [1,0,1,0,1],
    ];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (pattern[r][c]) {
          ctx.fillRect(c * pixelSize, r * pixelSize, pixelSize, pixelSize);
        }
      }
    }
    return canvas;
  },
};

export { PixelArt };
