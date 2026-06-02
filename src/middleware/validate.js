const { body, validationResult } = require('express-validator');

// Run after a validation chain: returns 400 with the first errors if any failed.
function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed.', details: errors.array() });
    }
    next();
}

const signupRules = [
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('username').trim().isLength({ min: 2, max: 40 }).withMessage('Username must be 2–40 characters.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
];

const loginRules = [
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.'),
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
