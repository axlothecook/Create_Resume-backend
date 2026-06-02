const mongoose = require('mongoose');

// A saved résumé belongs to a user and stores the FULL editor state verbatim so the
// frontend can restore the editing session exactly. The editor shape may evolve, so
// `data` is a flexible object (the backend persists/returns it as-is); only the
// envelope (owner, title, timestamps) is strongly typed.
const resumeSchema = new mongoose.Schema({
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    title: {
        type: String,
        trim: true,
        default: 'Untitled résumé',
        maxlength: 120,
    },
    // Full editor state: personalDetails, education/experience/skills/projects arrays,
    // the style object (color/font/layout/underlined/gridView), and sectionOrder.
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, { timestamps: true, minimize: false });

// Shape returned to the client.
resumeSchema.methods.toClientJSON = function toClientJSON() {
    return {
        id: this._id,
        title: this.title,
        data: this.data,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
    };
};

module.exports = mongoose.model('Resume', resumeSchema);
