// Guard: allow only authenticated requests through.
function requireAuth(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.status(401).json({ error: 'Not authenticated.' });
}

module.exports = { requireAuth };
