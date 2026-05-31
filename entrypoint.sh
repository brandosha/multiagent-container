#!/bin/bash
set -e

export SSH_KEY_PATH="/agents/ssh/id_ed25519"

# 1. Generate the key if missing
if [ ! -f "$SSH_KEY_PATH" ]; then
    echo "Generating a new ED25519 key..."
    mkdir -p /agents/ssh
    ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -C "multiagent" -N "" -q
    
    echo "=========================================================="
    echo "NEW SSH KEY GENERATED:"
    cat "${SSH_KEY_PATH}.pub"
    echo "=========================================================="
fi

# Ensure strict permissions so SSH doesn't complain
chmod 600 "$SSH_KEY_PATH"

# Set up mcp sockets directory
mkdir -p /tmp/mcp-sockets
chmod 711 /tmp/mcp-sockets

# setup CODEX_HOME
export AGENTS_GID=9999
export CODEX_HOME="/agents/.codex"
mkdir -p $CODEX_HOME
chmod 775 $CODEX_HOME
chgrp $AGENTS_GID $CODEX_HOME
chmod g+s $CODEX_HOME

touch "$CODEX_HOME/config.toml"
chmod 660 "$CODEX_HOME/config.toml"

# Start the server
export SERVER_PORT=80
exec pnpm run start