# Deployment Guide — UMass Boston Site

**Live:** https://umassboston.ink/
**VPS IP:** 104.156.225.159
**Hosting:** Vultr VPS (Ubuntu 22.04, 1 vCPU, 1 GB RAM)
**Repo:** https://github.com/Manikatlantis/UMB_NewWebsite

---

## Quick Deploy (one command)

From your local project root:

```bash
./deploy.sh
```

This pushes to GitHub, SSHs into the VPS, pulls the latest code, and restarts the backend.

---

## Manual Deploy

### 1. Commit and push your changes

```bash
git add umass-boston.html
git commit -m "Describe your change"
git push origin main
```

### 2. SSH into the server

```bash
ssh root@104.156.225.159
```

### 3. Pull and restart

```bash
cd /var/www/umass-boston
git pull origin main
```

If you changed backend code (`server.js`, `routes/api.js`, `models/`, etc.):

```bash
cd backend
npm install          # only if package.json changed
pm2 restart server
```

If you only changed `umass-boston.html` or other static files, no restart needed — Nginx serves them directly.

---

## SSH Access

```bash
ssh root@104.156.225.159
```

Project lives at: `/var/www/umass-boston`

---

## Server Management

### Check if the app is running

```bash
pm2 status
```

### View live logs

```bash
pm2 logs server
pm2 logs server --lines 100    # last 100 lines
```

### Restart the backend

```bash
pm2 restart server
```

### Stop / start the backend

```bash
pm2 stop server
pm2 start server
```

### Check Nginx status

```bash
systemctl status nginx
```

### Restart Nginx

```bash
systemctl restart nginx
```

### View Nginx error logs

```bash
tail -50 /var/log/nginx/error.log
tail -50 /var/log/nginx/access.log
```

---

## Troubleshooting

### Site not loading at all

1. Check if Nginx is running:
   ```bash
   systemctl status nginx
   ```
   If it's not running: `systemctl start nginx`

2. Check if the Node app is running:
   ```bash
   pm2 status
   ```
   If it shows "stopped" or "errored": `pm2 restart server`

3. Check if port 80/443 are open:
   ```bash
   ufw status
   ```
   If not: `ufw allow 80/tcp && ufw allow 443/tcp`

### Site loads but shows errors / blank page

1. Check backend logs:
   ```bash
   pm2 logs server --lines 50
   ```

2. Check if MongoDB is reachable:
   ```bash
   cd /var/www/umass-boston/backend
   node -e "require('./config/db'); setTimeout(() => process.exit(), 5000)"
   ```

3. Check the `.env` file has correct values:
   ```bash
   cat /var/www/umass-boston/backend/.env
   ```

### Chat / AI not working

- Check if `ANTHROPIC_API_KEY` is set in `.env`
- Check logs for "Anthropic API error": `pm2 logs server --lines 50`

### Maps not loading

- Check if `GOOGLE_MAPS_API_KEY` is set in `.env`
- Verify the key isn't restricted to wrong referrers in Google Cloud Console

### SSL certificate expired

```bash
certbot renew
systemctl reload nginx
```

### Git pull fails with conflicts

```bash
cd /var/www/umass-boston
git stash                  # stash any server-side changes
git pull origin main
git stash pop              # re-apply if needed
```

Or if you don't care about server-side changes:

```bash
git fetch origin main
git reset --hard origin/main
pm2 restart server
```

### App crashed and won't restart

```bash
pm2 delete server
cd /var/www/umass-boston/backend
pm2 start server.js --name server
pm2 save
```

### Server ran out of memory

```bash
free -m                    # check memory
pm2 restart server         # restart to clear memory
```

### Check what's using a port

```bash
lsof -i :3000             # check what's on port 3000
lsof -i :80               # check what's on port 80
```

---

## Architecture

```
Client → https://umassboston.ink
         ↓
      Nginx (port 80/443, SSL termination)
         ↓
      Node.js/Express (port 3000, PM2 managed)
         ↓
      MongoDB Atlas (cloud database)
```

### Nginx config location

```
/etc/nginx/sites-available/umass-boston
/etc/nginx/sites-enabled/umass-boston
```

### PM2 config

```bash
pm2 save                   # save process list
pm2 startup                # enable auto-start on boot
```

---

## Project Structure

```
umass-boston/
├── umass-boston.html           ← Single-page frontend (all HTML/CSS/JS)
├── pretext.js                 ← Pretext library for text reflow
├── the-editorial-engine.js    ← Editorial engine reference
├── deploy.sh                  ← One-command deploy script
├── Umass-Boston-Logo-01.png
├── umass_logo_2.jpg
├── .gitignore
├── DEPLOY.md                  ← This guide
├── README.md
└── backend/
    ├── server.js              ← Express entry point
    ├── package.json
    ├── .env.example           ← Template (copy to .env, never commit .env)
    ├── config/
    │   └── db.js              ← MongoDB connection
    ├── models/
    │   ├── Visit.js           ← Analytics schema
    │   ├── ChatLog.js         ← Chat history schema
    │   └── BuildingPhoto.js   ← Building photo schema
    └── routes/
        └── api.js             ← /api/track, /api/chat, /api/maps-key, /api/stats, /api/building-photos
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Port Node.js listens on (default 3000) |
| `MONGO_URI` | MongoDB Atlas connection string |
| `GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API key |
| `ANTHROPIC_API_KEY` | Anthropic API key for Harbor chatbot |
| `ALLOWED_ORIGIN` | CORS allowed origin (`https://umassboston.ink`) |

The `.env` file lives at `/var/www/umass-boston/backend/.env` on the server. Never commit it to git.

---

## Initial Server Setup (if starting fresh)

### 1. Create Vultr VPS

- Log in at [my.vultr.com](https://my.vultr.com)
- Deploy → Cloud Compute → Ubuntu 22.04 LTS → $6/mo plan
- Add your SSH key, deploy, note the IP

### 2. Install dependencies

```bash
ssh root@YOUR_IP
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx
npm install -g pm2
```

### 3. Clone and configure

```bash
cd /var/www
git clone https://github.com/Manikatlantis/UMB_NewWebsite.git umass-boston
cd umass-boston/backend
npm install
cp .env.example .env
nano .env    # fill in real values
```

### 4. Start with PM2

```bash
pm2 start server.js --name server
pm2 save
pm2 startup    # run the command it prints
```

### 5. Configure Nginx

```bash
nano /etc/nginx/sites-available/umass-boston
```

```nginx
server {
    listen 80;
    server_name umassboston.ink www.umassboston.ink;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/umass-boston /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### 6. HTTPS with Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d umassboston.ink -d www.umassboston.ink
systemctl reload nginx
```

### 7. Firewall

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```
