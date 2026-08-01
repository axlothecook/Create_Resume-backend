const request = require('supertest');
const { startTestApp, stopTestApp, clearDb } = require('./helpers');

jest.mock('../src/lib/mailer', () => ({ sendPasswordReset: jest.fn() }));

// The rest of the suite runs with rateLimits OFF (see helpers.js), because the
// limiter store has no per-test reset and every request comes from one IP. This file
// opts back IN so the limiters themselves are covered rather than assumed.
//
// trustProxy is on so each test can present its own visitor IP through
// X-Forwarded-For, which is the only way to exercise a per-IP limiter from a single
// test process. That works only because `trust proxy` resolves to the real visitor —
// see tests/trust-proxy.test.js.
const CLOUDFLARED = '172.20.0.6';
const from = (visitorIp) => `${visitorIp}, ${CLOUDFLARED}`;

let app;
beforeAll(async () => { app = await startTestApp({ rateLimits: true, trustProxy: true }); });
afterAll(async () => { await stopTestApp(); });
afterEach(async () => { await clearDb(); });

// Each test uses its OWN visitor IP and email: the limiter store persists for the
// whole file (MemoryStore has no reset), so reusing keys would leak counts between
// tests. Unique keys keep them independent without needing a reset that doesn't exist.
const post = (ip, email) => request(app)
    .post('/auth/forgot-password')
    .set('X-Forwarded-For', from(ip))
    .send({ email });

describe('forgot-password rate limiting', () => {
    test('allows 5 requests from one IP, then 429s the 6th', async () => {
        const ip = '203.0.113.10';
        for (let i = 0; i < 5; i++) {
            // Distinct emails so the per-EMAIL limiter (3/hour) can't be what trips.
            await post(ip, `ip-test-${i}@example.com`).expect(200);
        }
        const blocked = await post(ip, 'ip-test-5@example.com');
        expect(blocked.status).toBe(429);
        // Flat error envelope, matching this app's shape — not { error: { message } }.
        expect(typeof blocked.body.error).toBe('string');
    });

    test('a different visitor is unaffected by the first one hitting the wall', async () => {
        const spammer = '203.0.113.20';
        for (let i = 0; i < 5; i++) await post(spammer, `spam-${i}@example.com`).expect(200);
        await post(spammer, 'spam-5@example.com').expect(429);

        // With the old `trust proxy: 1` both visitors keyed to cloudflared and this
        // would have been a 429 — one spammer locking the endpoint for everyone.
        await post('198.51.100.30', 'bystander@example.com').expect(200);
    });

    test('limits per EMAIL too, so a distributed attacker cannot mail-bomb one account', async () => {
        const victim = 'victim@example.com';
        // Three different IPs, one target address: the per-IP limiter never fires.
        await post('203.0.113.41', victim).expect(200);
        await post('203.0.113.42', victim).expect(200);
        await post('203.0.113.43', victim).expect(200);

        const blocked = await post('203.0.113.44', victim);
        expect(blocked.status).toBe(429);
    });

    test('the per-email limit applies to UNREGISTERED addresses too (no oracle)', async () => {
        // If the limiter only counted real accounts, a 429-vs-200 difference would
        // confirm which addresses are registered — the enumeration leak the identical
        // 200 response exists to prevent.
        const ghost = 'never-signed-up@example.com';
        await post('203.0.113.51', ghost).expect(200);
        await post('203.0.113.52', ghost).expect(200);
        await post('203.0.113.53', ghost).expect(200);
        await post('203.0.113.54', ghost).expect(429);
    });

    test('sets draft-8 RateLimit headers', async () => {
        const res = await post('203.0.113.60', 'headers@example.com');
        expect(res.status).toBe(200);
        // draft-8 uses one combined `RateLimit` header; draft-6's separate
        // `RateLimit-Limit` must be absent, which is what passing `true` would give.
        expect(res.headers).toHaveProperty('ratelimit');
        expect(res.headers['ratelimit-limit']).toBeUndefined();
    });
});
