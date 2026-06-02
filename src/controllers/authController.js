const passport = require('passport');
const User = require('../models/User');

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
            return res.status(201).json({ user: user.toSafeJSON() });
        });
    } catch (err) {
        next(err);
    }
}

// POST /auth/login — authenticate via the local strategy and start a session.
function login(req, res, next) {
    passport.authenticate('local', (err, user, info) => {
        if (err) return next(err);
        if (!user) return res.status(401).json({ error: (info && info.message) || 'Invalid credentials.' });
        req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
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

module.exports = { signup, login, logout, me };
