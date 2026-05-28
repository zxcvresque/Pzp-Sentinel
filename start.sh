#!/usr/bin/env bash
# PzP Sentinel — dev start (Linux / macOS / Git Bash)

set -e

OS="$(uname -s)"
case "$OS" in
  Linux*)   platform="Linux" ;;
  Darwin*)  platform="macOS" ;;
  MINGW*|MSYS*|CYGWIN*) platform="Windows (Git Bash)" ;;
  *)        platform="$OS" ;;
esac

echo ""
echo "  PzP Sentinel"
echo "  Platform: $platform"
echo "  Starting Next.js + Telegram Bot..."
echo ""

npx concurrently \
  --names "next,bot" \
  --prefix-colors "green,magenta" \
  --kill-others \
  "npm run dev" \
  "npm run bot:dev"
