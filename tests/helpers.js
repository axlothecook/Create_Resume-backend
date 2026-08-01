const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { createApp } = require('../src/createApp');

let mongod;
let app;

// Start an ephemeral in-memory MongoDB, connect mongoose, and build the app whose
// session store points at the same instance. Returns the Express app for supertest.
// `appOptions` overrides createApp settings for tests that need a non-default app
// (e.g. trustProxy, to reproduce the production proxy chain).
async function startTestApp(appOptions = {}) {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    // rateLimits off by default here: the whole suite shares one IP and the limiter
    // store has no per-test reset, so counts would bleed between unrelated tests.
    // tests/rate-limit.test.js opts back in to cover the limiters themselves.
    app = createApp({
        mongoUrl: uri,
        sessionSecret: 'test-secret',
        quiet: true,
        rateLimits: false,
        ...appOptions,
    });
    return app;
}

async function stopTestApp() {
    // Close the session store's own MongoClient BEFORE stopping the server, so no
    // open socket is left to die with an ECONNRESET mid-teardown.
    if (app && app.sessionStore) {
        // The store builds its TTL index in a background promise chain; a fast suite
        // can reach teardown while that's still in flight, and close() would then
        // reject it as an UNHANDLED rejection (it isn't the promise close() returns),
        // failing the suite. A no-op get() awaits that chain via the public API, so
        // by the time close() runs nothing is left to interrupt.
        await new Promise((resolve) => app.sessionStore.get('teardown-sync', resolve));
        await app.sessionStore.close();
    }
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
