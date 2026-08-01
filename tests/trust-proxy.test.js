const request = require('supertest');
const { startTestApp, stopTestApp } = require('./helpers');

// Regression test for the `trust proxy` setting in src/createApp.js.
//
// Rate limiters key on `req.ip`, so req.ip MUST resolve to the real visitor. If it
// resolves to a proxy instead, every visitor shares ONE bucket and the first abuser
// locks the endpoint for everyone. That was a live bug in the archery backend
// (fixed 2026-07-27) and this app had the identical misconfiguration.
//
// The production chain, reproduced here through X-Forwarded-For:
//   browser → Cloudflare edge → cloudflared → nginx (frontend container) → this app
// Cloudflare sets X-Forwarded-For to the visitor IP; nginx then APPENDS the
// cloudflared container address via `$proxy_add_x_forwarded_for` (see nginx.conf in
// the frontend repo). Supertest's loopback socket stands in for the nginx hop.
//
// The cloudflared container's real address on the Pi (docker network 172.20.0.0/16).
// Private, so `trust proxy` must skip it and keep walking left to the visitor.
const CLOUDFLARED = '172.20.0.6';
const chain = (visitorIp) => `${visitorIp}, ${CLOUDFLARED}`;

const FIXED = 'loopback, uniquelocal'; // what createApp sets when trustProxy is on

let app;

beforeAll(async () => {
    // trustProxy mirrors production (app.js passes `isProd`).
    app = await startTestApp({ trustProxy: true });
    // Report how Express resolved the client IP. Mounted HERE rather than in createApp
    // so production never ships a debug endpoint. A route added after createApp still
    // matches: its error handler takes 4 args, so it only runs via next(err).
    app.get('/__probe-ip', (req, res) => res.json({ ip: req.ip }));
});

afterAll(async () => { await stopTestApp(); });

const probe = (xff) => request(app).get('/__probe-ip').set('X-Forwarded-For', xff);

describe('client IP resolution behind the proxy chain', () => {
    test('resolves req.ip to the real visitor, skipping both private proxy hops', async () => {
        const res = await probe(chain('203.0.113.7'));
        expect(res.body.ip).toBe('203.0.113.7');
    });

    test('two visitors resolve to two different IPs, so they get separate buckets', async () => {
        const a = await probe(chain('203.0.113.7'));
        const b = await probe(chain('198.51.100.50'));
        expect(a.body.ip).toBe('203.0.113.7');
        expect(b.body.ip).toBe('198.51.100.50');
        expect(a.body.ip).not.toBe(b.body.ip);
    });

    test('ignores X-Forwarded-For entries a client injects (no key spoofing)', async () => {
        // Cloudflare appends the true visitor IP to the RIGHT of whatever the client
        // sent, so injected entries sit further left and must never become the key.
        const res = await probe(`9.9.9.9, 203.0.113.42, ${CLOUDFLARED}`);
        expect(res.body.ip).toBe('203.0.113.42');
    });

    test('the old `trust proxy: 1` collapsed every visitor onto cloudflared (the bug)', async () => {
        // Express reads this setting per request, so flipping it reproduces the old
        // production behaviour on the same app. Restored in `finally` either way.
        app.set('trust proxy', 1);
        try {
            const a = await probe(chain('203.0.113.7'));
            const b = await probe(chain('198.51.100.50'));
            // Two different people, one rate-limit key. This is what the fix prevents.
            expect(a.body.ip).toBe(CLOUDFLARED);
            expect(b.body.ip).toBe(CLOUDFLARED);
        } finally {
            app.set('trust proxy', FIXED);
        }
    });
});
