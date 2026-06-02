const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('./config/passport');
const authRouter = require('./routes/authRouter');
const resumeRouter = require('./routes/resumeRouter');

// Build the Express app. Pure: no DB connection and no listen() — the caller wires
// those (app.js for real runs, the test harness for tests).
//   mongoUrl     — connection string for the session store
//   secureCookie — true in production (HTTPS): sets Secure + SameSite=None so the
//                  cookie works when the SPA and API are on different subdomains
//   trustProxy   — true when running behind a reverse proxy (Cloudflare Tunnel),
//                  so Express treats the proxied connection as secure
//   quiet        — silence request logging (tests)
function createApp({ mongoUrl, sessionSecret, secureCookie = false, trustProxy = false, quiet = false } = {}) {
    const app = express();

    // Behind Cloudflare/another proxy, honour X-Forwarded-* so `secure` cookies are
    // sent and req.protocol reflects the original HTTPS request.
    if (trustProxy) app.set('trust proxy', 1);

    app.use(express.json());
    if (!quiet) app.use(morgan('dev'));
    app.use(cors({
        origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
        credentials: true, // allow the session cookie cross-origin
    }));

    // Sessions stored in MongoDB; the session id rides in an httpOnly cookie.
    // Cross-site cookies (different subdomain) require SameSite=None + Secure; in dev
    // (HTTP) use Lax + non-secure so the cookie still works on localhost.
    app.use(session({
        secret: sessionSecret || process.env.SESSION_SECRET || 'dev-insecure-secret',
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({ mongoUrl }),
        cookie: {
            httpOnly: true,
            sameSite: secureCookie ? 'none' : 'lax',
            secure: secureCookie,
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        },
    }));

    app.use(passport.initialize());
    app.use(passport.session());

    app.get('/', (req, res) => res.json({ ok: true, service: 'create-resume-backend' }));
    app.use('/auth', authRouter);
    app.use('/resumes', resumeRouter);

    // Global error handler (HTTP-status shape).
    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
        if (!quiet) console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
    });

    return app;
}

module.exports = { createApp };
