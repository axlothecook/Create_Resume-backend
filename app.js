require('dotenv').config();
const { connectDb } = require('./src/db/connect');
const { createApp } = require('./src/createApp');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/create_resume';
const PORT = process.env.PORT || 3006;

const isProd = process.env.NODE_ENV === 'production';
const app = createApp({
    mongoUrl: MONGO_URI,
    secureCookie: isProd, // HTTPS-only cookie + SameSite=None in production
    trustProxy: isProd, // behind Cloudflare Tunnel in production
});

connectDb(MONGO_URI)
    .then(() => app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`)))
    .catch((err) => {
        console.error('Failed to start: could not connect to MongoDB.', err.message);
        process.exit(1);
    });

module.exports = app;
