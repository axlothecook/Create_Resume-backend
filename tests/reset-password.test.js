const request = require('supertest');
const { startTestApp, stopTestApp, clearDb, makeUser } = require('./helpers');

jest.mock('../src/lib/mailer', () => ({ sendPasswordReset: jest.fn(), sendPasswordChanged: jest.fn() }));
const { sendPasswordReset, sendPasswordChanged } = require('../src/lib/mailer');

const User = require('../src/models/User');

let app;
beforeAll(async () => { app = await startTestApp(); });
afterAll(async () => { await stopTestApp(); });
afterEach(async () => { await clearDb(); jest.clearAllMocks(); });

// Drive the real flow: request a reset, then dig the plain token out of the link the
// mailer was handed. Going through the endpoint rather than minting a token directly
// means these tests exercise the same path a user takes.
async function requestReset(email) {
    await request(app).post('/auth/forgot-password').send({ email }).expect(200);
    const deadline = Date.now() + 2000;
    while (sendPasswordReset.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setImmediate(r));
    }
    const { url } = sendPasswordReset.mock.calls[0][0];
    return new URL(url).searchParams.get('token');
}

const NEW_PASSWORD = 'brandnewpass123';

describe('POST /auth/reset-password', () => {
    test('sets the new password: the new one works, the old one does not', async () => {
        const { creds } = await makeUser(app);
        const token = await requestReset(creds.email);

        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD })
            .expect(200);

        await request(app).post('/auth/login')
            .send({ email: creds.email, password: NEW_PASSWORD })
            .expect(200);
        await request(app).post('/auth/login')
            .send({ email: creds.email, password: creds.password })
            .expect(401);
    });

    test('does NOT log the user in (OWASP: no auto-login after reset)', async () => {
        const { creds } = await makeUser(app);
        const token = await requestReset(creds.email);

        const agent = request.agent(app);
        const res = await agent.post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD })
            .expect(200);
        expect(res.body.user).toBeUndefined();

        // The same agent keeps whatever cookies were set; it must still be anonymous.
        const me = await agent.get('/auth/me').expect(200);
        expect(me.body.user).toBeNull();
    });

    test('the token is single-use: replaying it fails', async () => {
        const { creds } = await makeUser(app);
        const token = await requestReset(creds.email);

        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD }).expect(200);

        const replay = await request(app).post('/auth/reset-password')
            .send({ token, password: 'thirdpassword123' });
        expect(replay.status).toBe(400);

        // And the replay changed nothing: the first new password still works.
        await request(app).post('/auth/login')
            .send({ email: creds.email, password: NEW_PASSWORD }).expect(200);
    });

    test('an expired token is rejected', async () => {
        const { creds } = await makeUser(app);
        const token = await requestReset(creds.email);

        // Wind the expiry back past now, exactly as the clock would.
        await User.updateOne(
            { email: creds.email },
            { $set: { resetTokenExpiresAt: new Date(Date.now() - 1000) } },
        );

        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD })
            .expect(400);
        // The old password must still be the live one.
        await request(app).post('/auth/login')
            .send({ email: creds.email, password: creds.password }).expect(200);
    });

    test('unknown, used and expired tokens give the IDENTICAL message (no oracle)', async () => {
        const { creds } = await makeUser(app);
        const realToken = await requestReset(creds.email);
        await request(app).post('/auth/reset-password')
            .send({ token: realToken, password: NEW_PASSWORD }).expect(200);

        const used = await request(app).post('/auth/reset-password')
            .send({ token: realToken, password: 'anotherpass123' });
        const unknown = await request(app).post('/auth/reset-password')
            .send({ token: 'a'.repeat(64), password: 'anotherpass123' });

        expect(used.status).toBe(unknown.status);
        expect(used.body).toEqual(unknown.body);
    });

    test('enforces the SAME password policy as signup, and does not burn the token', async () => {
        const { creds } = await makeUser(app);
        const token = await requestReset(creds.email);

        const weak = await request(app).post('/auth/reset-password')
            .send({ token, password: 'short' });
        expect(weak.status).toBe(400);
        expect(weak.body.details.some((d) => d.path === 'password')).toBe(true);

        // Rejected on policy, so the token must survive for a real attempt.
        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD })
            .expect(200);
    });

    test('notifies the account owner that their password changed (OWASP)', async () => {
        const { creds } = await makeUser(app);
        const token = await requestReset(creds.email);

        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD }).expect(200);

        // Sent after the response, so wait for it rather than asserting immediately.
        const deadline = Date.now() + 2000;
        while (sendPasswordChanged.mock.calls.length === 0 && Date.now() < deadline) {
            await new Promise((r) => setImmediate(r));
        }
        expect(sendPasswordChanged).toHaveBeenCalledTimes(1);
        expect(sendPasswordChanged.mock.calls[0][0]).toEqual({ to: creds.email });
    });

    test('a failing notification email does NOT fail the reset', async () => {
        const { creds } = await makeUser(app);
        const token = await requestReset(creds.email);
        sendPasswordChanged.mockRejectedValueOnce(new Error('Brevo send failed (400): nope'));
        const errLog = jest.spyOn(console, 'error').mockImplementation(() => {});

        // The password change already succeeded before the mail was attempted; a mail
        // outage must not tell the user their reset failed.
        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD }).expect(200);
        await request(app).post('/auth/login')
            .send({ email: creds.email, password: NEW_PASSWORD }).expect(200);

        errLog.mockRestore();
    });

    test('no notification is sent when the token was rejected', async () => {
        await request(app).post('/auth/reset-password')
            .send({ token: 'b'.repeat(64), password: NEW_PASSWORD }).expect(400);
        for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
        expect(sendPasswordChanged).not.toHaveBeenCalled();
    });

    test('rejects a malformed token without touching the database', async () => {
        const res = await request(app).post('/auth/reset-password')
            .send({ token: 'not-a-token', password: NEW_PASSWORD });
        expect(res.status).toBe(400);
        expect(res.body.details.some((d) => d.path === 'token')).toBe(true);
    });
});

describe('session invalidation after a reset', () => {
    test('logs out sessions issued under the old password, everywhere', async () => {
        // Two devices signed in as the same person.
        const { agent: deviceA, creds } = await makeUser(app);
        const deviceB = request.agent(app);
        await deviceB.post('/auth/login')
            .send({ email: creds.email, password: creds.password }).expect(200);

        // Both are live before the reset.
        expect((await deviceA.get('/auth/me')).body.user.email).toBe(creds.email);
        expect((await deviceB.get('/auth/me')).body.user.email).toBe(creds.email);

        const token = await requestReset(creds.email);
        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD }).expect(200);

        // Neither device survives: a stolen session elsewhere is dead.
        expect((await deviceA.get('/auth/me')).body.user).toBeNull();
        expect((await deviceB.get('/auth/me')).body.user).toBeNull();
    });

    test('a stale session cannot reach protected routes', async () => {
        const { agent, creds } = await makeUser(app);
        await agent.get('/resumes').expect(200);

        const token = await requestReset(creds.email);
        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD }).expect(200);

        await agent.get('/resumes').expect(401);
    });

    test('signing in again after the reset works normally', async () => {
        const { agent, creds } = await makeUser(app);
        const token = await requestReset(creds.email);
        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD }).expect(200);
        await agent.get('/auth/me').expect(200); // now anonymous

        const fresh = request.agent(app);
        await fresh.post('/auth/login')
            .send({ email: creds.email, password: NEW_PASSWORD }).expect(200);
        expect((await fresh.get('/auth/me')).body.user.email).toBe(creds.email);
        await fresh.get('/resumes').expect(200);
    });

    test('an unrelated user keeps their session', async () => {
        const { creds } = await makeUser(app);
        const { agent: other } = await makeUser(app);

        const token = await requestReset(creds.email);
        await request(app).post('/auth/reset-password')
            .send({ token, password: NEW_PASSWORD }).expect(200);

        expect((await other.get('/auth/me')).body.user).not.toBeNull();
    });
});
