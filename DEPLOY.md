# Deploying Fluxure

Two deployment models:

1. **Split** — Static frontend on Cloudflare Pages, API + DB on a VPS
2. **Self-Hosted** — Everything on one machine via Docker Compose

---

## Option A: Split (Cloudflare + VPS)

```
      fluxure.app ──► Cloudflare Pages (landing)
  app.fluxure.app ──► Cloudflare Pages (web app)
  api.fluxure.app ──► VPS (Docker: API + PostgreSQL)
```

### A1. VPS — API + Database

```bash
git clone https://github.com/FluxureCalendar/fluxure.git /opt/fluxure
cd /opt/fluxure && cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, Google OAuth, CORS_ORIGIN, SMTP
docker compose up -d
curl http://localhost:3000/api/health
```

Expose via **Cloudflare Tunnel** (free SSL):

```bash
cloudflared tunnel create fluxure-api
# Configure tunnel to proxy api.fluxure.app → localhost:3000
cloudflared service install && systemctl enable --now cloudflared
```

### A2. Cloudflare Pages — Landing

| Setting        | Value                                               |
| -------------- | --------------------------------------------------- |
| Build cmd      | `cd packages/landing && pnpm install && pnpm build` |
| Output         | `packages/landing/build`                            |
| Domain         | `fluxure.app`                                       |
| `NODE_VERSION` | `22`                                                |

### A3. Cloudflare Pages — Web App

| Setting          | Value                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Build cmd        | `cd packages/shared && pnpm install && pnpm build && cd ../web && pnpm install && pnpm build` |
| Output           | `packages/web/build`                                                                          |
| Domain           | `app.fluxure.app`                                                                             |
| `PUBLIC_API_URL` | `https://api.fluxure.app/api`                                                                 |

### A4. Google OAuth

Create credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
Redirect URI: `https://api.fluxure.app/api/auth/google/callback`. Enable Google Calendar API.

---

## Option B: Self-Hosted (All-in-One)

```
yourdomain.com ──► nginx (:80) ──► static files + /api/* → API (:3000) + /ws → WebSocket
```

```bash
git clone https://github.com/your-org/fluxure.git /opt/fluxure
cd /opt/fluxure && cp .env.example .env
# Edit .env: POSTGRES_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, Google OAuth, CORS_ORIGIN=https://yourdomain.com
chmod +x scripts/selfhost-build.sh && ./scripts/selfhost-build.sh
docker compose -f docker-compose.selfhost.yml up -d
```

Custom port: `FLUXURE_PORT=8080 docker compose -f docker-compose.selfhost.yml up -d`

For HTTPS, place Caddy or Cloudflare Tunnel in front.

---

## Backups

```bash
./scripts/backup.sh /backups                    # one-time
echo "0 3 * * * /opt/fluxure/scripts/backup.sh /backups" | crontab -  # daily

# Restore
gunzip < backup.sql.gz | docker exec -i fluxure-postgres-1 psql -U fluxure fluxure
```

## Troubleshooting

| Symptom                   | Fix                                        |
| ------------------------- | ------------------------------------------ |
| `ECONNREFUSED` on startup | `docker compose up -d postgres`            |
| Rate limiting broken      | Set `TRUST_PROXY=1` behind reverse proxy   |
| Emails not sending        | Configure `SMTP_*` vars in `.env`          |
| Calendar not syncing      | Verify Google OAuth credentials            |
| WebSocket disconnects     | Ensure `CORS_ORIGIN` includes frontend URL |
