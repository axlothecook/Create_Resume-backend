const passport = require('passport');
const User = require('../models/User');
const { sendPasswordReset, sendPasswordChanged } = require('../lib/mailer');

// Where the reset link points. Built from CONFIG, never from the request's Host
// header: a forged Host would otherwise send the victim a real token pointing at the
// attacker's domain (password-reset poisoning). Same default as the CORS origin.
function clientOrigin() {
    return (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
}

// POST /auth/signup — create an account, then log the user in (start a session).
async function signup(req, res, next) {
    try {
        const { email, username, password } = req.body;
        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

        const user = new User({ email, username });
        await user.setPassword(password);
        await user.save();

        // Establish the session immediately after signup.
        req.login(user, (err) => {
            if (err) return next(err);
            // Stamp the session with the password it was issued under, so a later
            // reset invalidates it (see middleware/sessionFreshness.js).
            req.session.passwordStamp = user.passwordStamp();
            return res.status(201).json({ user: user.toSafeJSON() });
        });
    } catch (err) {
        next(err);
    }
}

// 30 days, in ms — the "remember me" session length.
const REMEMBER_ME_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

// POST /auth/login — authenticate via the local strategy and start a session.
// `rememberMe` (boolean) controls how long the session cookie lasts:
//   true  → persistent for 30 days.
//   false → a browser-SESSION cookie (cleared when the browser fully closes).
function login(req, res, next) {
    passport.authenticate('local', (err, user, info) => {
        if (err) return next(err);
        if (!user) return res.status(401).json({ error: (info && info.message) || 'Invalid credentials.' });
        req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            // Override this session's cookie lifetime based on the remember-me choice.
            // Setting maxAge=null makes it a session cookie (no Expires/Max-Age sent).
            req.session.cookie.maxAge = req.body.rememberMe ? REMEMBER_ME_MAX_AGE : null;
            req.session.passwordStamp = user.passwordStamp();
            return res.json({ user: user.toSafeJSON() });
        });
    })(req, res, next);
}

// POST /auth/logout — end the session.
function logout(req, res, next) {
    req.logout((err) => {
        if (err) return next(err);
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ ok: true });
        });
    });
}

// GET /auth/me — current user (or null if not logged in).
function me(req, res) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.json({ user: req.user.toSafeJSON() });
    }
    return res.json({ user: null });
}

// POST /auth/forgot-password — email a reset link if the account exists.
//
// Answers 200 { ok: true } IMMEDIATELY and identically whether or not the address is
// registered, then does the lookup and the send afterwards. That closes both halves
// of the enumeration problem at once — ASVS 5.0 §6.3.8 requires that valid users
// can't be deduced "by basing on error messages, HTTP response codes, or different
// response times", and names forgot-password explicitly. Deferring the work means the
// response time carries no information about whether a user was found or mail was sent.
//
// The deferred half must swallow its own errors: the response has already been sent,
// and Express's docs are explicit that calling next(err) after that "closes the
// connection and fails the request".
async function forgotPassword(req, res) {
    const { email } = req.body;
    res.json({ ok: true });

    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return; // unknown address: say nothing, do nothing, look identical

        const token = await user.issueResetToken();
        const url = `${clientOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
        // `user.email` is the address OF RECORD from the database. Never req.body.email
        // as the destination (CWE-640: the requester must not choose where a reset
        // token is delivered) — the body only decides WHICH account, never WHERE.
        await sendPasswordReset({ to: user.email, url });
    } catch (err) {
        console.error('[forgot-password] deferred work failed:', err.message);
    }
}

// POST /auth/reset-password — set a new password using a token from the reset email.
//
// Deliberately does NOT log the user in afterwards: OWASP's Forgot Password guidance
// says "Don't automatically log the user in, as this introduces additional
// complexity". They sign in with the new password, which also proves it works.
async function resetPassword(req, res, next) {
    try {
        const { token, password } = req.body;

        const user = await User.findByLiveResetToken(token);
        // One message for unknown, already-used and expired tokens alike. Splitting
        // them would tell an attacker which tokens once existed.
        if (!user) {
            return res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
        }

        await user.setPassword(password); // also stamps passwordChangedAt
        user.clearResetToken();           // single use: the link dies here
        await user.save();                // one write for both

        // Every session issued under the old password now fails the stamp check in
        // middleware/sessionFreshness.js, so a stolen session elsewhere is dead.
        res.json({ ok: true });

        // Tell the account owner their password changed. Sent AFTER the response and
        // with its own catch: a mail outage must not turn a SUCCESSFUL reset into an
        // error, and next(err) here would try to respond twice.
        try {
            await sendPasswordChanged({ to: user.email });
        } catch (mailErr) {
            console.error('[reset-password] notification mail failed:', mailErr.message);
        }
        return;
    } catch (err) {
        return next(err);
    }
}

module.exports = { signup, login, logout, me, forgotPassword, resetPassword };
