const Resume = require('../models/Resume');

const MAX_RESUMES_PER_USER = 10;

// GET /resumes — list the current user's résumés (newest first, lightweight: no data blob).
async function listResumes(req, res, next) {
    try {
        const resumes = await Resume.find({ owner: req.user.id })
            .sort({ updatedAt: -1 })
            .select('title createdAt updatedAt');
        res.json({
            resumes: resumes.map(r => ({ id: r._id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt })),
            count: resumes.length,
            max: MAX_RESUMES_PER_USER,
        });
    } catch (err) {
        next(err);
    }
}

// GET /resumes/:id — full résumé (the editor state used to load/download). Owner-scoped.
async function getResume(req, res, next) {
    try {
        const resume = await Resume.findOne({ _id: req.params.id, owner: req.user.id });
        if (!resume) return res.status(404).json({ error: 'Résumé not found.' });
        res.json({ resume: resume.toClientJSON() });
    } catch (err) {
        if (err.name === 'CastError') return res.status(404).json({ error: 'Résumé not found.' });
        next(err);
    }
}

// POST /resumes — create a new résumé for the current user (enforces the per-account cap).
async function createResume(req, res, next) {
    try {
        const count = await Resume.countDocuments({ owner: req.user.id });
        if (count >= MAX_RESUMES_PER_USER) {
            return res.status(409).json({ error: `You can save at most ${MAX_RESUMES_PER_USER} résumés.` });
        }
        const resume = await Resume.create({
            owner: req.user.id,
            title: req.body.title,
            data: req.body.data || {},
        });
        res.status(201).json({ resume: resume.toClientJSON() });
    } catch (err) {
        next(err);
    }
}

// PUT /resumes/:id — replace title/data of an owned résumé.
async function updateResume(req, res, next) {
    try {
        const update = {};
        if (req.body.title !== undefined) update.title = req.body.title;
        if (req.body.data !== undefined) update.data = req.body.data;

        const resume = await Resume.findOneAndUpdate(
            { _id: req.params.id, owner: req.user.id },
            { $set: update },
            { new: true, runValidators: true },
        );
        if (!resume) return res.status(404).json({ error: 'Résumé not found.' });
        res.json({ resume: resume.toClientJSON() });
    } catch (err) {
        if (err.name === 'CastError') return res.status(404).json({ error: 'Résumé not found.' });
        next(err);
    }
}

// DELETE /resumes/:id — remove an owned résumé.
async function deleteResume(req, res, next) {
    try {
        const resume = await Resume.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
        if (!resume) return res.status(404).json({ error: 'Résumé not found.' });
        res.json({ ok: true, id: resume._id });
    } catch (err) {
        if (err.name === 'CastError') return res.status(404).json({ error: 'Résumé not found.' });
        next(err);
    }
}

module.exports = { listResumes, getResume, createResume, updateResume, deleteResume, MAX_RESUMES_PER_USER };
