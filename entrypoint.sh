#!/bin/bash
set -e

echo "Starting High-Density Agent Supervisor..."

KEY_PATH="/agents/ssh/id_ed25519"

# 1. Generate the key if missing
if [ ! -f "$KEY_PATH" ]; then
    echo "Generating a new ED25519 key..."
    mkdir -p /agents/ssh
    ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -q
    
    echo "=========================================================="
    echo "NEW SSH KEY GENERATED. ADD THIS PUBLIC KEY TO GITHUB:"
    cat "${KEY_PATH}.pub"
    echo "=========================================================="
fi

# Ensure strict permissions so SSH doesn't complain
chmod 600 "$KEY_PATH"

# Set up mcp sockets directory
mkdir -p /tmp/mcp-sockets
chmod 711 /tmp/mcp-sockets

exec pnpm run start