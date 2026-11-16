# Deploying TradeDesk on AWS EC2 (public + secure)

The setup this guide builds:

```
Internet ──443/80──▶ [EC2 security group] ──▶ nginx (HTTPS, rate limits) ──▶ TradeDesk on 127.0.0.1:4100
                     SSH 22 only from your IP           fail2ban bans brute-force IPs
```

The Node app is **never** exposed directly. Only nginx faces the internet, over HTTPS.

Commands are for **Ubuntu 22.04 / 24.04**. Amazon Linux notes are at the end.
Replace `news.example.com` with your domain throughout.

---

## 1. AWS console (do this first)

1. **Elastic IP:** EC2 → Elastic IPs → Allocate → Associate it with your instance. This keeps the IP fixed across reboots.
2. **Domain:** in your DNS (Route 53, GoDaddy, Cloudflare…) add an **A record** `news.example.com → <Elastic IP>`.
   HTTPS certificates need a domain name. A cheap domain works, and so does a free subdomain (e.g. DuckDNS).
3. **Security group** (EC2 → Security Groups → your instance's group → Inbound rules). Make it exactly this:

   | Type  | Port | Source | Why |
   |---|---|---|---|
   | HTTP  | 80  | 0.0.0.0/0 and ::/0 | Let's Encrypt + redirect to HTTPS |
   | HTTPS | 443 | 0.0.0.0/0 and ::/0 | The site |
   | SSH   | 22  | **My IP** only | Admin access |

   **Delete any rule for port 4100** (or "All traffic"). If your IP changes, update the SSH rule, or use EC2 Instance Connect / Session Manager instead of opening SSH.
4. **Require IMDSv2:** Instance → Actions → Instance settings → Modify instance metadata options → IMDSv2 **Required**. This blocks a common way attackers steal AWS credentials.
5. **Billing alarm:** Billing → Budgets → create a small monthly budget with email alerts, so a compromise can't run up a bill unnoticed.

## 2. Prepare the server

```bash
sudo apt update && sudo apt -y full-upgrade
sudo apt -y install nginx certbot python3-certbot-nginx fail2ban ufw unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # automatic security updates → Yes

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
node -v

# Firewall on the box too (defence in depth, matches the security group)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

**Harden SSH** (keep your current session open while testing a second login):

```bash
sudo tee /etc/ssh/sshd_config.d/90-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
X11Forwarding no
EOF
sudo systemctl restart ssh
```

## 3. Install the app in /opt/tradedesk as its own user

If it's already running another way (`pm2`, `node src/index.js` in a screen, etc.), **stop that first**:
`pm2 delete all` or `pkill -f "node src/index.js"`.

```bash
sudo useradd --system --home /opt/tradedesk --shell /usr/sbin/nologin tradedesk
sudo mkdir -p /opt/tradedesk

# Option A, from git:
sudo git clone https://github.com/<you>/tradedesk.git /opt/tradedesk
# Option B, copy from your PC (run on your PC, from the project folder):
#   scp -r src public config scripts deploy package.json package-lock.json ubuntu@<ip>:/tmp/tradedesk/
#   then on the server: sudo cp -r /tmp/tradedesk/* /opt/tradedesk/
# If you already have users/journal data on the server, copy its data/ folder into /opt/tradedesk/data/

cd /opt/tradedesk
sudo npm ci --omit=dev
sudo mkdir -p data
sudo chown -R tradedesk:tradedesk /opt/tradedesk
sudo chmod 750 /opt/tradedesk /opt/tradedesk/data
```

**Production `.env`:**

```bash
sudo cp /opt/tradedesk/.env.example /opt/tradedesk/.env
sudo nano /opt/tradedesk/.env
```

Set at least:

```ini
NODE_ENV=production
HOST=127.0.0.1          # only nginx can reach the app
PORT=4100
COOKIE_SECURE=true      # cookies only sent over HTTPS
TELEGRAM_BOT_TOKEN=...  # if you use alerts
```

```bash
sudo chown tradedesk:tradedesk /opt/tradedesk/.env
sudo chmod 600 /opt/tradedesk/.env
```

## 4. Run it as a service

```bash
sudo cp /opt/tradedesk/deploy/tradedesk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tradedesk
sudo systemctl status tradedesk
journalctl -u tradedesk -f            # live logs (Ctrl+C to exit)
```

The service runs as the unprivileged `tradedesk` user, in a sandbox that can only write to `data/` and `config/`, and restarts automatically if it crashes or the server reboots.

**First-run setup code:** if there are no users yet, the log prints
`First run: create the admin account with setup code  xxxxxxxx`. You need that code to create the admin, so a stranger who finds the site first can't take it over.

## 5. nginx + HTTPS

```bash
sudo cp /opt/tradedesk/deploy/tradedesk-proxy.conf /etc/nginx/snippets/
sudo cp /opt/tradedesk/deploy/nginx-tradedesk.conf /etc/nginx/sites-available/tradedesk
sudo sed -i 's/news.example.com/YOUR.DOMAIN/' /etc/nginx/sites-available/tradedesk
sudo ln -s /etc/nginx/sites-available/tradedesk /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Free HTTPS certificate + automatic HTTP→HTTPS redirect + auto-renewal
sudo certbot --nginx -d YOUR.DOMAIN --redirect -m you@example.com --agree-tos --no-eff-email
sudo certbot renew --dry-run
```

Open `https://YOUR.DOMAIN`. You should see the padlock and the TradeDesk login.

## 6. Ban brute-force attackers (fail2ban)

The app writes audit lines like `[audit] … login-failed ip=1.2.3.4 user=admin`. fail2ban reads them and bans an IP for 24 h after 8 failures in 15 min (SSH too):

```bash
sudo cp /opt/tradedesk/deploy/fail2ban-tradedesk.conf /etc/fail2ban/filter.d/tradedesk.conf
sudo cp /opt/tradedesk/deploy/fail2ban-jail.local /etc/fail2ban/jail.d/tradedesk.local
sudo systemctl restart fail2ban
sudo fail2ban-client status tradedesk
# Unban yourself if needed: sudo fail2ban-client set tradedesk unbanip <ip>
```

## 7. Backups

```bash
sudo chmod +x /opt/tradedesk/deploy/backup.sh
sudo crontab -e        # add:  30 2 * * * /opt/tradedesk/deploy/backup.sh
```

This keeps 14 days of `data/` (users, journals, screenshots) in `/var/backups/tradedesk`. Also turn on **EBS snapshots**: EC2 → Lifecycle Manager → daily snapshot policy for the instance's volume. That way you can recover even if the server itself is lost.

## 8. Check it

```bash
curl -sI https://YOUR.DOMAIN/login.html | grep -iE 'strict-transport|content-security|x-frame|x-content'
curl -s -o /dev/null -w '%{http_code}\n' http://<ELASTIC-IP>:4100/     # must time out / fail
sudo ss -tlnp | grep 4100                                               # must show 127.0.0.1:4100
```

For a full grade, test the domain at <https://www.ssllabs.com/ssltest/> (aim for A) and <https://securityheaders.com> (aim for A).

## 9. Updating the app

```bash
cd /opt/tradedesk
sudo -u tradedesk git pull            # or copy the new files in
sudo npm ci --omit=dev
sudo chown -R tradedesk:tradedesk /opt/tradedesk
sudo systemctl restart tradedesk
npm audit --omit=dev                  # check dependencies for known holes
```

## What protects the site

| Layer | Protection |
|---|---|
| AWS | Only 80/443 open to the world; SSH only from your IP; IMDSv2; billing alarm |
| OS | ufw firewall, key-only SSH, automatic security updates, fail2ban |
| nginx | HTTPS (TLS by Let's Encrypt), HTTP→HTTPS redirect, login rate limit 10/min per IP, API rate limit, connection limit, upload size cap, hides version, blocks dotfiles/scanner paths |
| systemd | App runs as an unprivileged user, read-only filesystem except `data/` and `config/`, no privilege escalation |
| App | Passwords hashed with scrypt (min 10 chars, common ones rejected); signed HttpOnly, SameSite, Secure session cookies; lockout after 10 wrong passwords per IP / 20 per username; one-time setup code for the first admin; CSRF check on every change; strict Content-Security-Policy (no inline or third-party scripts); no framing (clickjacking); per-IP API rate limit; audit log of logins and admin actions; journals private per user; screenshots only served to their owner |

## Good habits

- Use a long unique password for the admin. Give other users their own accounts, and **disable** accounts people no longer use.
- Look at `journalctl -u tradedesk | grep audit` now and then for unexpected logins.
- Never commit `.env` or `data/` (both are in `.gitignore`).
- Keep only the admin accounts you need. Admins can manage every user.
- Optional extra layer: put the domain behind **Cloudflare** (free plan). It hides your server's IP, adds DDoS protection and a WAF. If you do, set the security group to allow 80/443 only from Cloudflare's IP ranges.

## Amazon Linux 2023 differences

- Install with `sudo dnf -y install nginx certbot python3-certbot-nginx fail2ban` and Node from `dnf install nodejs20` or NodeSource.
- nginx site files go in `/etc/nginx/conf.d/tradedesk.conf` (no sites-available/sites-enabled). Snippets path is the same once you create `/etc/nginx/snippets/`.
- There is no ufw. The security group is your firewall (optionally use `firewalld`).
- SSH service is `sshd`, and the default user is `ec2-user`.
