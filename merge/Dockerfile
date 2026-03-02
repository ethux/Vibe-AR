FROM python:3.12-slim

# Install system deps, Node.js 22, and ttyd
RUN apt-get update && apt-get install -y \
    curl \
    git \
    tmux \
    build-essential \
    vim \
    nano \
    wget \
    unzip \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "arm64" ]; then TTYD_ARCH="aarch64"; else TTYD_ARCH="x86_64"; fi \
    && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}" \
    && chmod +x /usr/local/bin/ttyd \
    # Install GitHub CLI (gh)
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install common Python packages + MCP server deps
RUN pip install --no-cache-dir \
    mistral-vibe \
    numpy pandas matplotlib requests flask fastapi uvicorn httpx \
    pytest black ruff \
    "mcp[cli]>=1.0.0" websockets

# Install common Node.js tools
RUN npm install -g \
    next create-next-app \
    typescript ts-node \
    eslint prettier \
    nodemon

# Copy MCP server into container
COPY mcp-server /opt/mcp-server

# Configure Vibe global config at ~/.vibe (survives volume mounts)
RUN mkdir -p /root/.vibe && \
    printf '[[providers]]\nname = "mistral"\napi_base = "http://web:3001/mistral-proxy/v1"\napi_key_env_var = "MISTRAL_API_KEY"\nbackend = "generic"\n\n[[mcp_servers]]\nname = "vibe_ar"\ntransport = "stdio"\ncommand = "python"\nargs = ["/opt/mcp-server/server.py"]\nenv = { "VIBE_WEB_URL" = "http://web:3001", "VIBE_WORKSPACE" = "/workspace" }\nstartup_timeout_sec = 10\ntool_timeout_sec = 30\n' > /root/.vibe/config.toml

# Pre-trust /workspace so Vibe reads local .vibe/config.toml too
RUN mkdir -p /root/.vibe && \
    printf 'trusted = ["/workspace"]\nuntrusted = []\n' > /root/.vibe/trusted_folders.toml

# Set VIBE_HOME so Vibe always finds the global config
ENV VIBE_HOME=/root/.vibe

# Working directory for vibe sessions
WORKDIR /workspace

# Entrypoint: copy config to workspace .vibe/ on startup (volume mount overwrites build-time files)
RUN printf '#!/bin/sh\nmkdir -p /workspace/.vibe\ncp -n /root/.vibe/config.toml /workspace/.vibe/config.toml 2>/dev/null || true\nexec "$@"\n' > /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# ttyd serves on 7681 by default
EXPOSE 7681

# Launch ttyd running vibe directly (no tmux)
# --writable allows input, --port sets port
CMD ["ttyd", "--port", "7681", "--writable", "-t", "fontSize=14", "-t", "theme={'background':'#0c0c12','foreground':'#e0e0e0','cursor':'#ff6b00'}", "vibe", "--agent", "auto-approve"]
