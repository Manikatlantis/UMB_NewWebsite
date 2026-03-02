#!/bin/bash
# Deploy to Vultr VPS — push local changes, pull on server
set -e

echo "⟶ Deploying to Vultr..."

# Push local commits to remote
git push origin main

# SSH into VPS, pull latest, restart backend if needed
ssh root@104.156.225.159 "cd /var/www/umass-boston && git pull origin main && echo '✓ Files updated' && if pm2 list 2>/dev/null | grep -q server; then pm2 restart server && echo '✓ Backend restarted'; fi"

echo "✓ Deploy complete"
