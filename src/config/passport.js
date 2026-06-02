const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const User = require('../models/User');

// Authenticate by email + password. usernameField maps the form's "email" field
// onto passport-local's default "username" slot.
passport.use(new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
        try {
            const user = await User.findOne({ email: email.toLowerCase().trim() });
            if (!user) return done(null, false, { message: 'Invalid email or password.' });
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
