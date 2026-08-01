const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { randomBytes, createHash } = require('crypto');
const { promisify } = require('util');

const randomBytesAsync = promisify(randomBytes);

// How long a password-reset link stays valid. 15 minutes: OWASP's testing guide says
// a reset link "should rarely be more than an hour", while ASVS 5.0 caps out-of-band
// requests at 10 minutes. 15 is short enough to satisfy the spirit of both and still
// long enough for someone to open the mail on a phone.
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

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
    // Password-reset token, stored ONLY as a SHA-256 hash: someone who reads the DB
    // must not be able to mint a working reset link. A slow hash (bcrypt) is deliberate
    // for user-chosen passwords but pointless here — the token is 32 random bytes
    // (256 bits), far past ASVS 5.0's 112-bit line for using a standard hash function.
    resetTokenHash: {
        type: String,
        default: null,
    },
    resetTokenExpiresAt: {
        type: Date,
        default: null,
    },
    // When the password last changed. Sessions carry a copy of this value, so a reset
    // makes every session issued under the OLD password stop matching and get thrown
    // out (see middleware/sessionFreshness.js). Null for accounts that never reset,
    // including every account that existed before this feature.
    passwordChangedAt: {
        type: Date,
        default: null,
    },
}, { timestamps: true });

// Hash a plain password and store it. Call before saving a new/changed password.
// Also stamps passwordChangedAt, which is what invalidates sessions issued under the
// previous password.
userSchema.methods.setPassword = async function setPassword(plain) {
    this.passwordHash = await bcrypt.hash(plain, 12);
    this.passwordChangedAt = new Date();
};

// The value a session stores to prove it was issued under the CURRENT password.
// Normalised to a number-or-null so a session created before this field existed
// (stamp `undefined`) still equals a user who has never reset (`null`) — otherwise
// deploying this would log out every existing user.
userSchema.methods.passwordStamp = function passwordStamp() {
    return this.passwordChangedAt ? this.passwordChangedAt.getTime() : null;
};

// Compare a candidate password against the stored hash.
userSchema.methods.verifyPassword = function verifyPassword(plain) {
    return bcrypt.compare(plain, this.passwordHash);
};

// Never leak the hash in JSON responses.
userSchema.methods.toSafeJSON = function toSafeJSON() {
    return { id: this._id, email: this.email, username: this.username };
};

// SHA-256 of a reset token, hex-encoded — the ONLY form that ever touches the DB.
function hashResetToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

// Issue a fresh password-reset token: store its hash + expiry on the user (replacing
// any earlier one — the newest link is the only valid one), and RETURN the plain
// token for the reset email. The plain form is never persisted anywhere.
userSchema.methods.issueResetToken = async function issueResetToken() {
    // 32 bytes = 256 bits of CSPRNG entropy (OWASP WSTG floor: 128 bits). Async form
    // so token generation never blocks the event loop.
    const token = (await randomBytesAsync(32)).toString('hex');
    this.resetTokenHash = hashResetToken(token);
    this.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await this.save();
    return token;
};

// Find the user holding a LIVE (unexpired) reset token. Looks up by the token's
// hash, so the comparison happens on hashes and the plain token never enters a query
// against stored plaintext. Returns null for unknown, cleared, or expired tokens.
userSchema.statics.findByLiveResetToken = function findByLiveResetToken(token) {
    return this.findOne({
        resetTokenHash: hashResetToken(token),
        resetTokenExpiresAt: { $gt: new Date() },
    });
};

// Clear the reset token (call after a successful reset — makes the link single-use;
// archery's tokens stay replayable for 30 min, a flaw flagged in the 2026-07-27
// audit that this flow deliberately does not inherit). Does NOT save; the caller
// saves once alongside the new password so the reset is one write.
userSchema.methods.clearResetToken = function clearResetToken() {
    this.resetTokenHash = null;
    this.resetTokenExpiresAt = null;
};

module.exports = mongoose.model('User', userSchema);
