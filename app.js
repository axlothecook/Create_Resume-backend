require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { connectDb } = require('./src/db/connect');
const passport = require('./src/config/passport');
const authRouter = require('./src/routes/authRouter');

const app = express();
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/create_resume';

app.use(express.json());
app.use(morgan('dev'));
app.use(cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true, // allow the session cookie cross-origin
}));

// Sessions stored in MongoDB; the session id rides in an httpOnly cookie.
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
}));

app.use(passport.initialize());
app.use(passport.session());

// Health check.
app.get('/', (req, res) => res.json({ ok: true, service: 'create-resume-backend' }));

app.use('/auth', authRouter);

// Global error handler (HTTP-status shape).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3006;

connectDb(MONGO_URI)
    .then(() => app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`)))
    .catch((err) => {
        console.error('Failed to start: could not connect to MongoDB.', err.message);
        process.exit(1);
    });

module.exports = app;
