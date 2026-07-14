const { body, validationResult } = require('express-validator');

// Run after a validation chain: returns 400 with the first errors if any failed.
function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed.', details: errors.array() });
    }
    next();
}

// "Clean" password = no whitespace (space/tab/newline) and no control characters.
// Checked by codepoint (mirrors the frontend src/auth/passwordRules.js isClean) so
// the source needs no literal control characters.
function isCleanPassword(p) {
    for (let i = 0; i < p.length; i++) {
        const c = p.charCodeAt(i);
        if (c <= 0x20) return false;              // space (0x20) + C0 control chars
        if (c >= 0x7f && c <= 0x9f) return false; // DEL + C1 control chars
    }
    return true;
}

// Password rules (mirror of the frontend src/auth/passwordRules.js): at least 8
// chars, at least one letter, at least one number, and no whitespace or control
// characters. Each check reports its own message so the client can show specifics.
const signupRules = [
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('username')
        .trim()
        .isLength({ min: 2, max: 40 }).withMessage('Username must be 2–40 characters.')
        // The username is stored in the CLEAR and shown in the UI, so it must never be the
        // password. One account was created with its password sitting in this field (an
        // autofill slip — the form and API map the two correctly), which silently exposed
        // the secret. Reject it at the door rather than trust the client.
        .custom((value, { req }) => value !== req.body.password)
        .withMessage('Username must not be the same as your password.'),
    body('password')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
        .matches(/[a-zA-Z]/).withMessage('Password must contain a letter.')
        .matches(/[0-9]/).withMessage('Password must contain a number.')
        .custom((value) => isCleanPassword(value)).withMessage('Password must not contain spaces or invalid characters.'),
];

const loginRules = [
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.'),
    // Optional "remember me": when true the session cookie lasts 30 days, else it's a
    // browser-session cookie. Coerce to a real boolean so the controller can trust it.
    body('rememberMe').optional().toBoolean(),
];

// Résumé create/update. `title` is optional; `data` (the full editor state) must be
// an object when provided.
const resumeCreateRules = [
    body('title').optional().isString().trim().isLength({ max: 120 }).withMessage('Title must be at most 120 characters.'),
    body('data').optional().isObject().withMessage('data must be an object.'),
];

const resumeUpdateRules = [
    body('title').optional().isString().trim().isLength({ max: 120 }).withMessage('Title must be at most 120 characters.'),
    body('data').optional().isObject().withMessage('data must be an object.'),
];

module.exports = { handleValidation, signupRules, loginRules, resumeCreateRules, resumeUpdateRules };
