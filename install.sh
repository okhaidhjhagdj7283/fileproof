#!/bin/bash
set -e

echo "=== FileProof Install Script ==="
echo ""

if ! command -v node &> /dev/null; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "Node: $(node -v) | npm: $(npm -v)"
echo ""

cd /root/fileproof

echo "Installing dependencies..."
npm install

mkdir -p uploads database

if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  Created .env from .env.example"
  echo "   Edit .env and set JWT_SECRET before starting."
fi

echo ""
echo "=== Install complete ==="
echo ""
echo "Edit .env:"
echo "  nano /root/fileproof/.env"
echo ""
echo "Run app:"
echo "  cd /root/fileproof && node server.js"
echo ""
echo "Or with pm2:"
echo "  npm install -g pm2"
echo "  pm2 start server.js --name fileproof"
echo "  pm2 save && pm2 startup"
echo ""
echo "App runs at: http://localhost:3000"
