require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { connectDb } = require('./src/db/connect');

const app = express();

app.use(express.json());
app.use(morgan('dev'));
app.use(cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
}));

// Health check — confirms the API is up.
app.get('/', (req, res) => {
    res.json({ ok: true, service: 'create-resume-backend' });
});

// Global error handler (HTTP-status shape).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3006;

connectDb(process.env.MONGO_URI || 'mongodb://localhost:27017/create_resume')
    .then(() => {
        app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
    })
    .catch((err) => {
        console.error('Failed to start: could not connect to MongoDB.', err.message);
        process.exit(1);
    });

module.exports = app;
