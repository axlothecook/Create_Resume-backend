const request = require('supertest');
const { startTestApp, stopTestApp, clearDb, makeUser } = require('./helpers');

let app;
beforeAll(async () => { app = await startTestApp(); });
afterAll(async () => { await stopTestApp(); });
afterEach(async () => { await clearDb(); });

describe('auth', () => {
    test('health check responds', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('signup creates a user, starts a session, and never leaks the hash', async () => {
        const agent = request.agent(app);
        const res = await agent.post('/auth/signup')
            .send({ email: 'new@example.com', username: 'Newbie', password: 'supersecret123' });
        expect(res.status).toBe(201);
        expect(res.body.user).toMatchObject({ email: 'new@example.com', username: 'Newbie' });
        expect(res.body.user.passwordHash).toBeUndefined();
        // session is live:
        const me = await agent.get('/auth/me');
        expect(me.body.user.email).toBe('new@example.com');
    });

    test('signup rejects invalid input (bad email, short username, weak password)', async () => {
        const res = await request(app).post('/auth/signup')
            .send({ email: 'notanemail', username: 'x', password: '123' });
        expect(res.status).toBe(400);
        // A weak password can trip several password rules at once, so dedupe paths —
        // we're asserting WHICH fields errored, not how many times each did.
        const paths = [...new Set(res.body.details.map((d) => d.path))].sort();
        expect(paths).toEqual(['email', 'password', 'username']);
    });

    test('signup rejects a password missing a number / letter / with spaces', async () => {
        const bad = ['alllettersonly', '12345678', 'has space1', 'short1'];
        for (const password of bad) {
            const res = await request(app).post('/auth/signup')
                .send({ email: `pw${bad.indexOf(password)}@example.com`, username: 'Valid', password });
            expect(res.status).toBe(400);
            expect(res.body.details.some((d) => d.path === 'password')).toBe(true);
        }
    });

    test('signup rejects a duplicate email', async () => {
        await makeUser(app, { email: 'dup@example.com' });
        const res = await request(app).post('/auth/signup')
            .send({ email: 'dup@example.com', username: 'Other', password: 'supersecret123' });
        expect(res.status).toBe(409);
    });

    test('login succeeds with correct credentials and fails with wrong password', async () => {
        await makeUser(app, { email: 'log@example.com', password: 'supersecret123' });
        const ok = await request(app).post('/auth/login')
            .send({ email: 'log@example.com', password: 'supersecret123' });
        expect(ok.status).toBe(200);
        expect(ok.body.user.email).toBe('log@example.com');

        const bad = await request(app).post('/auth/login')
            .send({ email: 'log@example.com', password: 'wrongpassword' });
        expect(bad.status).toBe(401);
    });

    test('login with a non-existent email returns 401 (no user enumeration)', async () => {
        const res = await request(app).post('/auth/login')
            .send({ email: 'ghost@example.com', password: 'whatever123' });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid/i);
    });

    test('logout ends the session', async () => {
        const { agent } = await makeUser(app);
        await agent.post('/auth/logout').expect(200);
        const me = await agent.get('/auth/me');
        expect(me.body.user).toBeNull();
    });

    test('/auth/me returns null when not logged in', async () => {
        const res = await request(app).get('/auth/me');
        expect(res.status).toBe(200);
        expect(res.body.user).toBeNull();
    });
});
