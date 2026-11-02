#!/usr/bin/env bash
# MorpheFlow 1-Click Cloudflare Workers Deployer
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "  MorpheFlow 1-Click Cloudflare Deployer"
echo "=================================================="

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed."
    echo "Please install Node.js from https://nodejs.org/ (v20+ recommended)."
    exit 1
fi

# Ensure npm dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing required npm dependencies..."
    npm install --no-fund --no-audit
fi

# Run the automated deployment script
node scripts/deploy-cf.cjs "$@"
