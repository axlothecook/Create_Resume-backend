# Resume Creator — Backend

API-only backend for the [Resume Creator](https://github.com/axlothecook/Create_Resume) app.

## Stack
- **Express 5** (JSON API)
- **MongoDB** via **Mongoose**
- **Session + cookie auth**: Passport (local strategy) + `express-session` + `connect-mongo` + `bcryptjs`
- Validation via `express-validator`

## Setup
```bash
npm install
cp .env.example .env   # then fill in MONGO_URI, SESSION_SECRET, etc.
npm run dev            # nodemon on PORT (default 3006)
npm test               # Jest (in-memory Mongo, no local DB needed)
```
Requires a running MongoDB for dev/prod (local: `mongodb://localhost:27017`).

## Docker
```bash
docker build -t create-resume-backend .
docker run --rm -p 3006:3006 --env-file .env create-resume-backend
```
The image is production-only (`npm ci --omit=dev`, runs `node app.js` as the `node`
user). The MongoDB container + multi-service compose live in the separate deploy repo
(same pattern as gaming-shop-deploy on the Pi).

## Production notes
When `NODE_ENV=production` the app: trusts the reverse proxy (`trust proxy`, for
Cloudflare Tunnel) and sets a **Secure + SameSite=None** httpOnly session cookie — so
it must be served over **HTTPS**, and `CLIENT_ORIGIN` must be the real frontend URL
(needed for CORS + cross-subdomain cookies).

## Structure
```
app.js              entry point
src/
  db/connect.js     mongoose connection
  models/           mongoose schemas (User, Resume)
  config/           passport / session setup
  middleware/       auth guards, validators
  controllers/      route handlers
  routes/           express routers
```

## Endpoints (planned)
- `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST/PUT/DELETE /resumes` (saved résumés, max 10/account)
