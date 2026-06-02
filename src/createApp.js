const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('./config/passport');
const authRouter = require('./routes/authRouter');
const resumeRouter = require('./routes/resumeRouter');

// Build the Express app. Pure: no DB connection and no listen() — the caller wires
// those (app.js for real runs, the test harness for tests). `mongoUrl` is the
// connection string used for the session store; `quiet` silences request logging.
function createApp({ mongoUrl, sessionSecret, secureCookie = false, quiet = false } = {}) {
    const app = express();

    app.use(express.json());
    if (!quiet) app.use(morgan('dev'));
    app.use(cors({
        origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
        credentials: true, // allow the session cookie cross-origin
    }));

    // Sessions stored in MongoDB; the session id rides in an httpOnly cookie.
    app.use(session({
        secret: sessionSecret || process.env.SESSION_SECRET || 'dev-insecure-secret',
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({ mongoUrl }),
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
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
