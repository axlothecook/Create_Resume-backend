const request = require('supertest');
const { startTestApp, stopTestApp, clearDb, makeUser } = require('./helpers');

// The mailer is mocked so the tests can assert WHO was mailed and WHAT link was sent
// without a provider. Must be mocked before createApp pulls in the controller.
jest.mock('../src/lib/mailer', () => ({ sendPasswordReset: jest.fn() }));
const { sendPasswordReset } = require('../src/lib/mailer');

const User = require('../src/models/User');

let app;
beforeAll(async () => { app = await startTestApp(); });
afterAll(async () => { await stopTestApp(); });
afterEach(async () => { await clearDb(); jest.clearAllMocks(); });

// The controller answers BEFORE it does its work, so the send happens after the HTTP
// response has returned. Wait for the mock rather than sleeping a fixed amount.
async function waitForMailer(calls = 1, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (sendPasswordReset.mock.calls.length < calls && Date.now() < deadline) {
        await new Promise((r) => setImmediate(r));
    }
    return sendPasswordReset.mock.calls.length >= calls;
}

// Give the deferred work a chance to run when asserting it did NOTHING, so the test
// can't pass merely by checking too early.
async function settle() {
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
}

describe('POST /auth/forgot-password', () => {
    test('returns 200 { ok: true } for a registered address', async () => {
        const { creds } = await makeUser(app);
        const res = await request(app).post('/auth/forgot-password').send({ email: creds.email });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    test('returns a byte-identical response for an UNKNOWN address (no enumeration)', async () => {
        const { creds } = await makeUser(app);
        const known = await request(app).post('/auth/forgot-password').send({ email: creds.email });
        await waitForMailer(1);
        const unknown = await request(app).post('/auth/forgot-password').send({ email: 'nobody@example.com' });

        expect(unknown.status).toBe(known.status);
        expect(unknown.body).toEqual(known.body);
        expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(known.body));
    });

    test('sends no mail at all for an unknown address', async () => {
        await request(app).post('/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(200);
        await settle();
        expect(sendPasswordReset).not.toHaveBeenCalled();
    });

    test('stores the token HASHED, never in the clear, with a ~15 minute expiry', async () => {
        const { creds } = await makeUser(app);
        const before = Date.now();
        await request(app).post('/auth/forgot-password').send({ email: creds.email }).expect(200);
        expect(await waitForMailer(1)).toBe(true);

        // Pull the plain token out of the link the mailer was handed.
        const { url } = sendPasswordReset.mock.calls[0][0];
        const plain = new URL(url).searchParams.get('token');
        expect(plain).toMatch(/^[a-f0-9]{64}$/); // 32 random bytes, hex

        const user = await User.findOne({ email: creds.email });
        expect(user.resetTokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256, hex
        expect(user.resetTokenHash).not.toBe(plain); // the hash is NOT the token
        // And the stored hash is genuinely the hash OF that token: the round trip works.
        expect(await User.findByLiveResetToken(plain)).not.toBeNull();

        const ttlMs = user.resetTokenExpiresAt.getTime() - before;
        expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
        expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    });

    test('a second request replaces the first token, so only the newest link works', async () => {
        const { creds } = await makeUser(app);
        await request(app).post('/auth/forgot-password').send({ email: creds.email }).expect(200);
        expect(await waitForMailer(1)).toBe(true);
        const first = new URL(sendPasswordReset.mock.calls[0][0].url).searchParams.get('token');

        await request(app).post('/auth/forgot-password').send({ email: creds.email }).expect(200);
        expect(await waitForMailer(2)).toBe(true);
        const second = new URL(sendPasswordReset.mock.calls[1][0].url).searchParams.get('token');

        expect(second).not.toBe(first);
        expect(await User.findByLiveResetToken(first)).toBeNull();
        expect(await User.findByLiveResetToken(second)).not.toBeNull();
    });

    test('mails the address OF RECORD, never one smuggled in the body (CWE-640)', async () => {
        const { creds } = await makeUser(app);
        await request(app)
            .post('/auth/forgot-password')
            .send({ email: creds.email, to: 'attacker@evil.test', sendTo: 'attacker@evil.test' })
            .expect(200);
        expect(await waitForMailer(1)).toBe(true);

        const { to } = sendPasswordReset.mock.calls[0][0];
        expect(to).toBe(creds.email);
        expect(to).not.toBe('attacker@evil.test');
    });

    test('builds the reset link from configured origin, not the Host header', async () => {
        const { creds } = await makeUser(app);
        await request(app)
            .post('/auth/forgot-password')
            .set('Host', 'evil.test')
            .set('X-Forwarded-Host', 'evil.test')
            .send({ email: creds.email })
            .expect(200);
        expect(await waitForMailer(1)).toBe(true);

        const { url } = sendPasswordReset.mock.calls[0][0];
        expect(url).not.toContain('evil.test');
        expect(url.startsWith(process.env.CLIENT_ORIGIN || 'http://localhost:5173')).toBe(true);
        expect(url).toContain('/reset-password?token=');
    });

    test('rejects a malformed email with 400 and issues no token', async () => {
        const res = await request(app).post('/auth/forgot-password').send({ email: 'notanemail' });
        expect(res.status).toBe(400);
        expect(res.body.details.some((d) => d.path === 'email')).toBe(true);
        await settle();
        expect(sendPasswordReset).not.toHaveBeenCalled();
    });
});
