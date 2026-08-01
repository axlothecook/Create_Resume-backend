// Log out sessions that were issued under a PREVIOUS password.
//
// Why this exists rather than deleting rows: OWASP's Forgot Password guidance says to
// "invalidate the sessions automatically" after a reset, and the archery backend does
// exactly that with `prisma.session.deleteMany({ where: { adminId } })` — trivial,
// because sessions there are a real table with an admin foreign key.
//
// connect-mongo cannot do that. It stores each session as an opaque JSON STRING
// (`stringify` defaults to true) keyed only by session id, and passport buries the
// user id INSIDE that string, so there is no field to query by. The maintainers
// closed the request for a delete-by-user API as wontfix (issue #447). Matching on
// the serialized text would work but is brittle: unindexed, and silently broken the
// day connect-mongo's `crypto` option is switched on.
//
// So invalidation is logical instead of physical. Each session stores the user's
// password stamp at login; if the stored stamp stops matching the user's current one,
// the session predates the password change and is destroyed on its next request. Two
// properties fall out of this: it works with ANY session store, and it needs no clock
// comparison — the stamps either match or they don't.
function sessionFreshness(req, res, next) {
    if (!req.user || !req.session) return next();

    // `?? null` so a session predating this feature (undefined) matches a user who has
    // never changed their password (null), instead of being treated as stale.
    const sessionStamp = req.session.passwordStamp ?? null;
    if (sessionStamp === req.user.passwordStamp()) return next();

    // Stale. Tear the session down and continue UNAUTHENTICATED, so whatever comes
    // next sees an anonymous request: /auth/me reports null, protected routes 401.
    req.logout((err) => {
        if (err) return next(err);
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            next();
        });
    });
}

module.exports = { sessionFreshness };
