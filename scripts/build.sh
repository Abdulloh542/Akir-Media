#!/bin/bash
set -e

echo "=== Installing Node dependencies ==="
npm install

echo "=== Installing yt-dlp ==="
pip3 install -U yt-dlp 2>/dev/null || pip install -U yt-dlp 2>/dev/null || {
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod +x /usr/local/bin/yt-dlp
}

echo "=== Installing gallery-dl ==="
pip3 install gallery-dl 2>/dev/null || pip install gallery-dl 2>/dev/null || true

echo "=== Checking ffmpeg ==="
which ffmpeg && ffmpeg -version | head -1 || echo "ffmpeg not found (will use yt-dlp bundled)"

echo "=== Build complete ==="
yt-dlp --version && echo "yt-dlp OK"
