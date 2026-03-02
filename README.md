# UMass Boston — Interactive Campus Website

A single-page interactive website for UMass Boston featuring a WebGL hero, interactive Google Maps campus explorer, Harbor arcade game, and AI chatbot (Harbor).

**Live:** http://104.156.225.159

---

## Tech Stack

- **Frontend:** Single HTML file with vanilla JS, WebGL, Google Maps API
- **Backend:** Node.js + Express
- **Database:** MongoDB Atlas (free M0 cluster)
- **Hosting:** Vultr VPS (Ubuntu 22.04)
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx

---

## Replicable Setup Guide

### Part 1 — MongoDB Atlas (Free Cloud Database)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) and sign up / log in
2. **Create a free cluster:** Click "Build a Database" → select **M0 Sandbox** (free tier) → pick a cloud provider and region (e.g. AWS us-east-1) → name your cluster → click "Create"
3. **Create a database user:** Go to **Database Access** (left sidebar) → "Add New Database User" → set a username and strong password → role = "Read and write to any database" → click "Add User"
4. **Allow network access:** Go to **Network Access** (left sidebar) → "Add IP Address" → enter `0.0.0.0/0` (allow all — you'll restrict to your server IP later) → click "Confirm"
5. **Get your connection string:** Go to **Database** (left sidebar) → click "Connect" on your cluster → choose "Connect your application" → copy the URI. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?appName=YourApp
   ```
6. Replace `<username>` and `<password>` with the credentials from step 3
7. Paste this into your project's `backend/.env` as `MONGO_URI`

### Part 2 — Local Development

1. Clone the repo:
   ```bash
   git clone https://github.com/Manikatlantis/UMB_NewWebsite.git
   cd UMB_NewWebsite/backend
   ```
2. Copy the env template and fill in your values:
   ```bash
   cp .env.example .env
   # Edit .env with your MONGO_URI, GOOGLE_MAPS_API_KEY, etc.
   ```
3. Install dependencies and start:
   ```bash
   npm install
   npm run dev    # starts with nodemon for hot-reload
   ```
4. Visit `http://localhost:3000`

### Part 3 — Vultr VPS Setup

#### 3.1 Create the server
1. Log in at [my.vultr.com](https://my.vultr.com)
2. Click **"Deploy +"** → Deploy New Server
3. **Choose Type:** Shared CPU (cheapest — sufficient for small apps)
4. **Location:** New York (NJ) or nearest to your users
5. **Plan:** vc2-1c-1gb — $5/month (1 vCPU, 1 GB RAM, 25 GB SSD)
6. Click **"Configure >"**
7. **OS:** Ubuntu 22.04 LTS x64
8. **SSH Keys:** Add your public key (run `cat ~/.ssh/id_rsa.pub` locally, paste into Vultr under Account → SSH Keys first, then select it here). If you skip this, Vultr gives you a root password instead.
9. **Disable** Automatic Backups (saves $1-2/mo, not needed since code is on GitHub and data is on MongoDB Atlas)
10. **Hostname/Label:** give it a name like `umass-boston`
11. Click **"Deploy"**
12. Wait ~1 minute for the server to provision. Note the **IP address** from the server dashboard.

> **Note:** You need a payment method on file even if you have free credits. Go to Account → Billing to add a card first.

#### 3.2 SSH into the server
```bash
ssh root@YOUR_SERVER_IP
```

#### 3.3 Install Node.js 20, Nginx, and PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx
npm install -g pm2
```

Verify:
```bash
node --version    # v20.x.x
nginx -v          # nginx/1.18.x
pm2 --version     # 6.x.x
```

#### 3.4 Clone repo and install dependencies
```bash
cd /var/www
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git your-app-name
cd your-app-name/backend
npm install
```

#### 3.5 Create the .env file on the server
```bash
nano .env
```
Add your environment variables:
```
PORT=3000
MONGO_URI=mongodb+srv://...your connection string...
GOOGLE_MAPS_API_KEY=your-key-here
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_ORIGIN=http://YOUR_SERVER_IP
```
Save with `Ctrl+O`, exit with `Ctrl+X`.

#### 3.6 Start the app with PM2
```bash
pm2 start server.js --name your-app-name
pm2 save                # persist process list across reboots
pm2 startup             # generates a command — run it to enable auto-start on boot
```

Check status:
```bash
pm2 status              # should show "online"
pm2 logs your-app-name  # check for errors
```

#### 3.7 Configure Nginx reverse proxy
Create config:
```bash
nano /etc/nginx/sites-available/your-app-name
```
Paste:
```nginx
server {
    listen 80;
    server_name YOUR_SERVER_IP;

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

Enable and start:
```bash
ln -sf /etc/nginx/sites-available/your-app-name /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t                # should say "syntax is ok"
systemctl reload nginx
```

#### 3.8 Open firewall ports
```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw status              # verify 22, 80, 443 are allowed
```

Your site is now live at `http://YOUR_SERVER_IP`

### Part 4 — Deploying Updates

```bash
# On your local machine:
git add .
git commit -m "describe your change"
git push

# On the server:
ssh root@YOUR_SERVER_IP
cd /var/www/your-app-name
git pull
cd backend && npm install   # only if package.json changed
pm2 restart your-app-name
```

### Part 5 — Optional: Custom Domain + HTTPS

1. Buy a domain from Namecheap, Cloudflare, etc.
2. Add an **A record** pointing to your server IP
3. Update the Nginx `server_name` to your domain
4. Install Certbot for free HTTPS:
   ```bash
   apt install -y certbot python3-certbot-nginx
   certbot --nginx -d yourdomain.com -d www.yourdomain.com
   systemctl reload nginx
   ```
5. Update `ALLOWED_ORIGIN` in `.env` to `https://yourdomain.com`
6. `pm2 restart your-app-name`

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Port Node.js listens on (default 3000) |
| `MONGO_URI` | MongoDB Atlas connection string |
| `GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API key |
| `ANTHROPIC_API_KEY` | Anthropic API key for Harbor chatbot |
| `ALLOWED_ORIGIN` | CORS allowed origin (your domain in production) |

---

## Project Structure

```
├── umass-boston.html        # Single-page frontend
├── Umass-Boston-Logo-01.png
├── umass_logo_2.jpg
├── DEPLOY.md               # Original deployment notes
├── README.md               # This file
└── backend/
    ├── server.js            # Express entry point
    ├── package.json
    ├── .env.example         # Template (copy to .env)
    ├── config/
    │   └── db.js            # MongoDB connection
    ├── models/
    │   ├── Visit.js         # Analytics schema
    │   └── ChatLog.js       # Chat history schema
    └── routes/
        └── api.js           # /api/track, /api/chat, /api/maps-key, /api/stats
```
