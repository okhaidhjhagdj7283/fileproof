#!/bin/bash
set -e

echo "=== FileProof Install Script ==="
echo ""

if ! command -v node &> /dev/null; then
  echo "Cài Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "Node: $(node -v) | npm: $(npm -v)"
echo ""

cd /root/fileproof

echo "Cài dependencies..."
npm install

mkdir -p uploads database

echo ""
echo "=== Cài đặt xong! ==="
echo ""
echo "Chạy app:"
echo "  cd /root/fileproof"
echo "  node server.js"
echo ""
echo "Hoặc chạy nền:"
echo "  nohup node server.js > /root/fileproof/app.log 2>&1 &"
echo ""
echo "Cài pm2 để quản lý process:"
echo "  npm install -g pm2"
echo "  pm2 start server.js --name fileproof"
echo "  pm2 save && pm2 startup"
echo ""
echo "App chạy tại: http://localhost:3000"
