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
```
Requires a running MongoDB (local: `mongodb://localhost:27017`).

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
