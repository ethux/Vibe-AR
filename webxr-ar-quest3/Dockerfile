FROM python:3.12-slim

# Install dependencies and ttyd from GitHub releases
RUN apt-get update && apt-get install -y \
    curl \
    git \
    tmux \
    && ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "arm64" ]; then TTYD_ARCH="aarch64"; else TTYD_ARCH="x86_64"; fi \
    && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}" \
    && chmod +x /usr/local/bin/ttyd \
    && rm -rf /var/lib/apt/lists/*

# Install vibe
RUN pip install --no-cache-dir mistral-vibe

# Configure Vibe to route API calls through web server proxy (for TTS capture)
# Place config in both global (~/.vibe) and workspace (.vibe) locations
RUN mkdir -p /root/.vibe /workspace/.vibe && \
    printf '[[providers]]\nname = "mistral"\napi_base = "http://web:3001/mistral-proxy/v1"\napi_key_env_var = "MISTRAL_API_KEY"\nbackend = "generic"\n' | tee /root/.vibe/config.toml /workspace/.vibe/config.toml > /dev/null

# Working directory for vibe sessions
WORKDIR /workspace

# ttyd serves on 7681 by default
EXPOSE 7681

# Launch ttyd running vibe directly (no tmux)
# --writable allows input, --port sets port
CMD ["ttyd", "--port", "7681", "--writable", "-t", "fontSize=14", "-t", "theme={'background':'#0c0c12','foreground':'#e0e0e0','cursor':'#ff6b00'}", "vibe"]
