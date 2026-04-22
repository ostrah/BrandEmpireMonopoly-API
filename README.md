# Brand Empire Monopoly — API

Backend for the Brand Empire Monopoly multiplayer game.

## Stack
- Node.js + TypeScript + Express
- PostgreSQL (users, game history)
- Redis (active game state)
- JWT authentication
- Gmail SMTP for email verification
- WebSocket for realtime gameplay (stage 4)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Then fill in `.env` with your Gmail SMTP credentials and JWT secrets.

Generate strong JWT secrets (PowerShell):
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Run twice — for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.

### 3. Start Postgres & Redis
```bash
docker-compose up -d
```

### 4. Run migrations
```bash
npm run migrate
```

### 5. Start dev server
```bash
npm run dev
```

Visit http://localhost:4000/health — should return `{"status":"ok"}`.

## Scripts
- `npm run dev` — run dev server with hot reload (tsx watch)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled production build
- `npm run migrate` — apply pending SQL migrations
- `npm run typecheck` — type-check without emitting files
