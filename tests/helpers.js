const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { createApp } = require('../src/createApp');

let mongod;
let app;

// Start an ephemeral in-memory MongoDB, connect mongoose, and build the app whose
// session store points at the same instance. Returns the Express app for supertest.
async function startTestApp() {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    app = createApp({ mongoUrl: uri, sessionSecret: 'test-secret', quiet: true });
    return app;
}

async function stopTestApp() {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
}

// Wipe all collections between tests for isolation.
async function clearDb() {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

// Sign up a user via the API and return { agent, user } where agent keeps the
// session cookie (supertest.agent). Each call uses a unique email unless provided.
const request = require('supertest');
let counter = 0;
async function makeUser(appInstance, overrides = {}) {
    counter += 1;
    const creds = {
        email: overrides.email || `user${counter}@example.com`,
        username: overrides.username || `User${counter}`,
        password: overrides.password || 'supersecret123',
    };
    const agent = request.agent(appInstance);
    const res = await agent.post('/auth/signup').send(creds);
    return { agent, creds, user: res.body.user, signupRes: res };
}

module.exports = { startTestApp, stopTestApp, clearDb, makeUser };
