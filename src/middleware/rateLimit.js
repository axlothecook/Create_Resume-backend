const rateLimit = require('express-rate-limit');

// Rate limiters for the /auth routes.
//
// Only the CEILING here is standards-backed: NIST SP 800-63B-4 §3.2.2 says a verifier
// "SHALL limit consecutive failed authentication attempts ... to no more than 100".
// Every number below is a judgement call for an app with a handful of real users, and
// all of them sit far under that ceiling.
//
// Two keys, not one, per OWASP: per-IP alone is defeated by a distributed attacker,
// per-account alone invites targeted lockout of a specific victim. Both, soft and
// auto-expiring, so neither failure mode is available.
//
// These key on `req.ip`, which is only the real visitor because `trust proxy` is set
// to 'loopback, uniquelocal' in createApp.js. With the old `trust proxy: 1` every
// visitor resolved to the cloudflared container and shared ONE bucket — see
// tests/trust-proxy.test.js.

// Shared response shape. This app's error envelope is a FLAT string (see the error
// handler in createApp.js and every controller) — NOT the nested { error: { message } }
// used by the archery backend. Sending the nested form would break the frontend's
// error rendering.
const TOO_MANY = { error: 'Too many requests. Please try again later.' };

// The submitted email, normalised the same way express-validator stored it, as the
// per-account key. Length-capped so a huge body can't bloat the in-memory store.
// MUST count whether or not the account exists: keying only on real accounts would
// turn the limiter itself into an account-enumeration oracle (a 429 would confirm
// the address is registered).
function emailKey(req) {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    return `email:${email.toLowerCase().trim().slice(0, 254)}`;
}

// forgot-password counts EVERY request, not just failures: unlike login, the success
// IS the abuse — each one sends an email. skipSuccessfulRequests would make the
// limiter useless exactly when it matters.
//
// `identifier` is set on each limiter and standardHeaders is 'draft-8' explicitly:
// stacked limiters overwrite each other's RateLimit headers otherwise, and passing
// `true` silently means the older draft-6.
// Built per call, not once at import: each limiter owns an in-memory store, and the
// default MemoryStore only resets when the process restarts. Module-level singletons
// would therefore leak counts between every app built in one Jest process. Fresh
// limiters per createApp give each test file real isolation.
function createAuthLimiters() {
    return {
        forgotPasswordIp: rateLimit({
            windowMs: 60 * 60 * 1000, // 1 hour
            limit: 5,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            identifier: 'forgot-password-ip',
            message: TOO_MANY,
        }),
        forgotPasswordEmail: rateLimit({
            windowMs: 60 * 60 * 1000, // 1 hour
            limit: 3,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            identifier: 'forgot-password-email',
            keyGenerator: emailKey,
            message: TOO_MANY,
        }),
        // Unlike forgot-password, this one counts FAILURES only: a successful reset is
        // the legitimate outcome and shouldn't consume anyone's allowance. The token is
        // 256 bits so guessing is not the threat — this caps the cost of someone
        // hammering the endpoint with junk tokens.
        resetPasswordIp: rateLimit({
            windowMs: 60 * 60 * 1000, // 1 hour
            limit: 10,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            identifier: 'reset-password-ip',
            skipSuccessfulRequests: true,
            message: TOO_MANY,
        }),
    };
}

module.exports = { createAuthLimiters };
