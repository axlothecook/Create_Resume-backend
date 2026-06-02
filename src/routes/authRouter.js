const express = require('express');
const router = express.Router();
const { signup, login, logout, me } = require('../controllers/authController');
const { signupRules, loginRules, handleValidation } = require('../middleware/validate');

router.post('/signup', signupRules, handleValidation, signup);
router.post('/login', loginRules, handleValidation, login);
router.post('/logout', logout);
router.get('/me', me);

module.exports = router;
