const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { resumeCreateRules, resumeUpdateRules, handleValidation } = require('../middleware/validate');
const {
    listResumes, getResume, createResume, updateResume, deleteResume,
} = require('../controllers/resumeController');

// Every résumé route requires a logged-in user — this is also what enforces guest
// mode (guests can use the editor but cannot save/load/edit/delete on the server).
router.use(requireAuth);

router.get('/', listResumes);
router.get('/:id', getResume);
router.post('/', resumeCreateRules, handleValidation, createResume);
router.put('/:id', resumeUpdateRules, handleValidation, updateResume);
router.delete('/:id', deleteResume);

module.exports = router;
