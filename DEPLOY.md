# Deployment Guide — Vultr VPS + MongoDB Atlas + GitHub

This guide walks you through deploying the UMass Boston site on a Vultr VPS
with a Node.js backend, MongoDB Atlas database, and code managed on GitHub.

---

## Step 1 — GitHub Repository Setup

```bash
# From your project root (claude_code/)
git init
git add .
git commit -m "Initial commit — UMass Boston site"

# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/umass-boston.git
git branch -M main
git push -u origin main
```

> **Important:** `.gitignore` already excludes `backend/.env` and `node_modules/`.
> Your API keys stay local and never touch GitHub.

---

## Step 2 — MongoDB Atlas (Free Cloud Database)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → **Create a free cluster** (M0 Sandbox)
2. Under **Database Access** → Add a new user with a strong password
3. Under **Network Access** → Add IP `0.0.0.0/0` (allow all — you'll tighten this later)
4. Click **Connect** → **Connect your application** → copy the URI:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/umassboston
   ```
5. Paste this into `backend/.env` as `MONGO_URI`

---

## Step 3 — Vultr VPS Setup

### 3.1 Create the server
1. Log in at [vultr.com](https://www.vultr.com)
2. **Deploy New Server** → **Cloud Compute** → **Regular Performance**
3. Location: New York or nearest to your users
4. OS: **Ubuntu 22.04 LTS**
5. Plan: **$6/month** (1 vCPU, 1 GB RAM — sufficient for this project)
6. SSH Keys: add your public key (`~/.ssh/id_rsa.pub`) for passwordless login
7. Click **Deploy Now** — note the server IP address

### 3.2 SSH into the server
```bash
ssh root@YOUR_SERVER_IP
```

### 3.3 Install Node.js 20 (LTS)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v20.x.x
```

### 3.4 Install PM2 (process manager — keeps Node running after disconnect)
```bash
npm install -g pm2
```

### 3.5 Install Nginx (reverse proxy — handles HTTPS + port 80)
```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

---

## Step 4 — Deploy Your Code

### 4.1 Clone your GitHub repo on the server
```bash
cd /var/www
git clone https://github.com/YOUR_USERNAME/umass-boston.git
cd umass-boston/backend
```

### 4.2 Install dependencies
```bash
npm install
```

### 4.3 Create the `.env` file on the server
```bash
cp .env.example .env
nano .env
```
Fill in your real values:
```
PORT=3000
MONGO_URI=mongodb+srv://...
GOOGLE_MAPS_API_KEY=...
ANTHROPIC_API_KEY=...
ALLOWED_ORIGIN=https://yourdomain.com
```
Save and exit (`Ctrl+O`, `Ctrl+X`).

### 4.4 Start the app with PM2
```bash
pm2 start server.js --name umass-boston
pm2 save          # persist across reboots
pm2 startup       # follow the printed instruction to enable autostart
```

Check it's running:
```bash
pm2 status
pm2 logs umass-boston
```

---

## Step 5 — Nginx Reverse Proxy

### 5.1 Create an Nginx config
```bash
sudo nano /etc/nginx/sites-available/umass-boston
```
Paste:
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

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

### 5.2 Enable and reload
```bash
sudo ln -s /etc/nginx/sites-available/umass-boston /etc/nginx/sites-enabled/
sudo nginx -t          # test config — should say "syntax is ok"
sudo systemctl reload nginx
```

Now visit `http://YOUR_SERVER_IP` — your site should load!

---

## Step 6 — HTTPS with Let's Encrypt (free SSL)

> Only works if you have a domain name pointed at your server IP.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
sudo systemctl reload nginx
```

Certbot auto-renews every 90 days. Done — your site is now HTTPS.

---

## Step 7 — Updating the Site (deploy new changes)

```bash
# On your local machine — push changes to GitHub
git add .
git commit -m "Update: describe your change"
git push

# On the Vultr server — pull and restart
ssh root@YOUR_SERVER_IP
cd /var/www/umass-boston
git pull
cd backend && npm install   # only needed if package.json changed
pm2 restart umass-boston
```

---

## Project Structure

```
umass-boston/
├── umass-boston-v2.html        ← Front-end (served as static file)
├── Umass-Boston-Logo-01.png
├── .gitignore                  ← Excludes .env and node_modules
├── DEPLOY.md                   ← This guide
└── backend/
    ├── server.js               ← Express app entry point
    ├── package.json
    ├── .env.example            ← Template — copy to .env, never commit .env
    ├── config/
    │   └── db.js               ← MongoDB connection
    ├── models/
    │   ├── Visit.js            ← Analytics schema
    │   └── ChatLog.js          ← Chat history schema
    └── routes/
        └── api.js              ← /api/track, /api/chat, /api/stats
```

---

## Environment Variables Reference

| Variable | Description |
|---|---|
| `PORT` | Port Node.js listens on (default 3000) |
| `MONGO_URI` | MongoDB Atlas connection string |
| `GOOGLE_MAPS_API_KEY` | Your Google Maps API key |
| `ANTHROPIC_API_KEY` | Anthropic API key for Harbor chatbot |
| `ALLOWED_ORIGIN` | CORS allowed origin (your domain in production) |

---

## Next Steps

- **Restrict MongoDB Network Access** — once deployed, replace `0.0.0.0/0` with your Vultr server IP
- **Add the Anthropic chatbot** — uncomment the API call in `backend/routes/api.js` and add `@anthropic-ai/sdk` to dependencies
- **Move Google Maps key server-side** — add a `/api/maps-key` endpoint that returns the key only to your domain, remove it from the HTML
- **Add a domain** — buy a `.com` from Namecheap/Cloudflare, point it to your Vultr IP, then run Certbot for HTTPS
