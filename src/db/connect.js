const mongoose = require('mongoose');

// Connect to MongoDB via Mongoose. Resolves once connected, rejects on failure
// so app.js can decide whether to start the server.
async function connectDb(uri) {
    mongoose.connection.on('connected', () => console.log('MongoDB connected'));
    mongoose.connection.on('error', (err) => console.error('MongoDB error:', err.message));
    await mongoose.connect(uri);
}

module.exports = { connectDb };
