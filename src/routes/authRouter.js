const express = require('express');
const { signup, login, logout, me, forgotPassword, resetPassword } = require('../controllers/authController');
const {
    signupRules,
    loginRules,
    forgotPasswordRules,
    resetPasswordRules,
    handleValidation,
} = require('../middleware/validate');
const { createAuthLimiters } = require('../middleware/rateLimit');

// A factory rather than a bare router: the limiters must be built per app (their
// stores are per-instance) and tests need to switch them off. `rateLimits` defaults
// to true, so forgetting to pass it can only ever fail SAFE.
function createAuthRouter({ rateLimits = true } = {}) {
    const router = express.Router();
    const pass = (req, res, next) => next(); // stand-in when limiters are off
    const limiters = rateLimits ? createAuthLimiters() : null;
    const forgotIp = limiters ? limiters.forgotPasswordIp : pass;
    const forgotEmail = limiters ? limiters.forgotPasswordEmail : pass;
    const resetIp = limiters ? limiters.resetPasswordIp : pass;

    router.post('/signup', signupRules, handleValidation, signup);
    router.post('/login', loginRules, handleValidation, login);
    router.post('/logout', logout);
    router.get('/me', me);

    // Order matters: validation runs BEFORE the per-email limiter so the key is the
    // normalised address, and both limiters sit after express.json() (mounted in
    // createApp) so req.body.email is readable.
    router.post(
        '/forgot-password',
        forgotIp,
        forgotPasswordRules,
        handleValidation,
        forgotEmail,
        forgotPassword,
    );

    router.post('/reset-password', resetIp, resetPasswordRules, handleValidation, resetPassword);

    return router;
}

module.exports = { createAuthRouter };
