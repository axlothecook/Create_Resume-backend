const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('./config/passport');
const { createAuthRouter } = require('./routes/authRouter');
const resumeRouter = require('./routes/resumeRouter');
const { sessionFreshness } = require('./middleware/sessionFreshness');

// Build the Express app. Pure: no DB connection and no listen() — the caller wires
// those (app.js for real runs, the test harness for tests).
//   mongoUrl     — connection string for the session store
//   secureCookie — true in production (HTTPS): sets Secure + SameSite=None so the
//                  cookie works when the SPA and API are on different subdomains
//   trustProxy   — true when running behind a reverse proxy (Cloudflare Tunnel),
//                  so Express treats the proxied connection as secure
//   quiet        — silence request logging (tests)
//   rateLimits   — mount the /auth rate limiters. ON by default; tests turn it OFF
//                  because the default MemoryStore has no between-test reset and every
//                  request in the suite comes from one IP, so counts would bleed across
//                  unrelated tests. The limiters themselves are covered by their own
//                  test file, which opts back in.
function createApp({
    mongoUrl,
    sessionSecret,
    secureCookie = false,
    trustProxy = false,
    quiet = false,
    rateLimits = true,
} = {}) {
    const app = express();

    // Behind Cloudflare/another proxy, honour X-Forwarded-* so `secure` cookies are
    // sent and req.protocol reflects the original HTTPS request.
    //
    // The VALUE matters. `req.ip` must resolve to the real visitor, because rate
    // limiters key on it — if it resolves to a proxy instead, every visitor shares
    // ONE bucket and the first abuser locks the endpoint for everyone.
    //
    // Express resolves req.ip by walking [socket, ...X-Forwarded-For reversed] and
    // taking the first UNTRUSTED address. Production has TWO infrastructure hops:
    //   browser → Cloudflare edge → cloudflared → nginx (frontend container) → this app
    // Cloudflare sets X-Forwarded-For to the visitor IP, then nginx appends the
    // cloudflared container's address (`$proxy_add_x_forwarded_for` in nginx.conf).
    // So this app receives `X-Forwarded-For: <visitor>, <cloudflared>` over a socket
    // owned by nginx.
    //
    // `trust proxy: 1` trusts exactly one hop and therefore stops on the RIGHTMOST
    // header entry — cloudflared's private address, identical for every visitor.
    // Trusting the private ranges instead makes Express skip both container hops and
    // stop at the first PUBLIC address, which is the visitor IP Cloudflare appended.
    //
    // Not spoofable from outside: Cloudflare appends the real visitor IP to the RIGHT
    // of anything the client sent, so client-injected entries sit further left and are
    // never reached. This holds while the tunnel is the only way in (no host ports are
    // published — see docker-compose.prod.yml); revisit if one is ever added.
    // Harmless in dev, where there is no proxy and the socket IS the client.
    if (trustProxy) app.set('trust proxy', 'loopback, uniquelocal');

    app.use(express.json());
    if (!quiet) app.use(morgan('dev'));
    app.use(cors({
        origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
        credentials: true, // allow the session cookie cross-origin
    }));

    // Sessions stored in MongoDB; the session id rides in an httpOnly cookie.
    // The SPA and API are served on the SAME origin in production (nginx proxies
    // resume.axlothecook.com/api -> this backend), so the cookie is FIRST-PARTY and
    // uses SameSite=Lax — strict browsers ("block cross-site tracking") never drop it.
    // (Previously the API was a separate subdomain → cross-site → needed SameSite=None,
    // which those browsers blocked, breaking login on some phones.)
    // In production we still set Secure (HTTPS only); in dev (HTTP) Secure is off so
    // the cookie works on localhost.
    // Created outside the session() call and exposed on the app: the store opens its
    // OWN MongoClient (separate from mongoose's), and the test harness must be able
    // to close it on teardown — otherwise its socket dies with an ECONNRESET when the
    // in-memory Mongo stops, intermittently failing a suite. Harmless in production.
    const sessionStore = MongoStore.create({ mongoUrl });
    app.sessionStore = sessionStore;

    app.use(session({
        secret: sessionSecret || process.env.SESSION_SECRET || 'dev-insecure-secret',
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: secureCookie,
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        },
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    // Immediately after the session is loaded: drop sessions issued under a password
    // that has since been reset. Must sit before any route that reads req.user.
    app.use(sessionFreshness);

    app.get('/', (req, res) => res.json({ ok: true, service: 'create-resume-backend' }));
    app.use('/auth', createAuthRouter({ rateLimits }));
    app.use('/resumes', resumeRouter);

    // Global error handler (HTTP-status shape).
    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
        if (!quiet) console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
    });

    return app;
}

module.exports = { createApp };
