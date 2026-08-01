const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');

// A throwaway hash to verify against when the account does NOT exist.
//
// Without it, an unknown email returns immediately while a known one pays for a
// cost-12 bcrypt compare (~hundreds of ms). That difference is measurable from
// outside and turns login into an account-enumeration oracle — the exact thing
// ASVS 6.3.8 forbids: "valid users cannot be deduced from failed authentication
// challenges, such as by basing on error messages, HTTP response codes, or different
// response times."
//
// Hashed from random bytes at startup rather than hardcoded, so it is not a known
// digest anyone could look up, and no password can ever match it by construction.
// Costs one bcrypt (~0.3s) once per process.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);

// Authenticate by email + password. usernameField maps the form's "email" field
// onto passport-local's default "username" slot.
passport.use(new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
        try {
            const user = await User.findOne({ email: email.toLowerCase().trim() });
            if (!user) {
                // Burn the same work a real comparison would, then fail. Same message
                // and same status as a wrong password, so nothing distinguishes them.
                await bcrypt.compare(password, DUMMY_HASH);
                return done(null, false, { message: 'Invalid email or password.' });
            }
            const ok = await user.verifyPassword(password);
            if (!ok) return done(null, false, { message: 'Invalid email or password.' });
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    },
));

// Sessions store only the user id; deserialize loads the full user per request.
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user || false);
    } catch (err) {
        done(err);
    }
});

module.exports = passport;
