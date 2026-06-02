const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    username: {
        type: String,
        required: true,
        trim: true,
    },
    passwordHash: {
        type: String,
        required: true,
    },
}, { timestamps: true });

// Hash a plain password and store it. Call before saving a new/changed password.
userSchema.methods.setPassword = async function setPassword(plain) {
    this.passwordHash = await bcrypt.hash(plain, 12);
};

// Compare a candidate password against the stored hash.
userSchema.methods.verifyPassword = function verifyPassword(plain) {
    return bcrypt.compare(plain, this.passwordHash);
};

// Never leak the hash in JSON responses.
userSchema.methods.toSafeJSON = function toSafeJSON() {
    return { id: this._id, email: this.email, username: this.username };
};

module.exports = mongoose.model('User', userSchema);
