#!/bin/bash
set -e

echo "=== Akir Media Bot O'rnatuvchi ==="
echo ""

# Node.js tekshirish
if ! command -v node &> /dev/null; then
    echo "Node.js o'rnatilmoqda..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "✅ Node.js: $(node -v)"

# npm paketlari
echo "📦 npm paketlari o'rnatilmoqda..."
npm install
echo "✅ npm paketlar tayyor"

# yt-dlp
if ! command -v yt-dlp &> /dev/null; then
    echo "yt-dlp o'rnatilmoqda..."
    sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    sudo chmod a+rx /usr/local/bin/yt-dlp
fi
echo "✅ yt-dlp: $(yt-dlp --version)"

# ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "ffmpeg o'rnatilmoqda..."
    sudo apt-get install -y ffmpeg
fi
echo "✅ ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"

# gallery-dl
if ! command -v gallery-dl &> /dev/null; then
    echo "gallery-dl o'rnatilmoqda..."
    pip3 install gallery-dl 2>/dev/null || pip install gallery-dl 2>/dev/null || echo "⚠️ gallery-dl o'rnatilmadi (ixtiyoriy)"
fi

# Redis
if ! command -v redis-server &> /dev/null; then
    echo "Redis o'rnatilmoqda..."
    sudo apt-get install -y redis-server
    sudo systemctl enable redis-server
    sudo systemctl start redis-server
fi
echo "✅ Redis ishga tushdi"

# .env fayl
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "⚠️  .env fayli yaratildi. Iltimos tahrirlang:"
    echo "   nano .env"
    echo "   BOT_TOKEN ni kiriting!"
else
    echo "✅ .env fayli mavjud"
fi

# Papkalar
mkdir -p downloads logs
echo "✅ downloads/ va logs/ papkalari tayyor"

echo ""
echo "=== O'rnatish tugadi! ==="
echo ""
echo "Botni ishga tushirish:"
echo "  npm start           — oddiy rejim"
echo "  npm run dev         — development (nodemon)"
echo ""
echo "PM2 bilan (tavsiya):"
echo "  npm install -g pm2"
echo "  pm2 start src/bot.js --name akir-media-bot"
echo "  pm2 save && pm2 startup"
