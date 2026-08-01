// Outgoing mail, behind one seam.
//
// Brevo's transactional REST API is called DIRECTLY, with no SDK: the @getbrevo SDK
// has ESM/version churn, which matters more here than in the archery backend since
// this repo is CommonJS. Ported from Archery-club-backend/src/email/index.ts.
//
// When BREVO_API_KEY or EMAIL_FROM is unset (dev, tests, or simply not configured
// yet) the mail is LOGGED instead of sent, so the whole recovery flow is usable end
// to end without a live key — in local dev you read the reset link off the backend
// terminal. That fallback is also why a missing key must NEVER throw.
//
// Callers run these AFTER the HTTP response has been sent (timing-uniformity design),
// so they must catch failures and log them — never pass one to next(err): Express
// would try to error-respond on an already-sent response and kill the request.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

// Send one plaintext email, or log it when Brevo isn't configured.
async function sendEmail({ to, subject, text }) {
    const apiKey = process.env.BREVO_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!apiKey || !from) {
        console.log(`[email:console] to=${to} subject="${subject}"\n${text}`);
        return;
    }

    // `; charset=utf-8` is stated explicitly: JSON is UTF-8 by definition (RFC 8259)
    // and fetch already encodes it as such, but saying so removes ambiguity for
    // proxies. Keep any sender display name ASCII — Brevo is known to mangle it.
    const res = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
            'api-key': apiKey,
            'content-type': 'application/json; charset=utf-8',
            accept: 'application/json',
        },
        body: JSON.stringify({
            sender: { email: from },
            to: [{ email: to }],
            subject,
            textContent: text,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Brevo send failed (${res.status}): ${body}`);
    }
}

// The reset link. `to` is the address OF RECORD from the DB — never an address off
// the request body (CWE-640: the requester must not choose where the token goes).
async function sendPasswordReset({ to, url }) {
    await sendEmail({
        to,
        subject: 'Reset your Resume Creator password',
        text: [
            `Choose a new password here (the link is valid for 15 minutes):`,
            url,
            '',
            "If this wasn't you, you can ignore this email.",
            '',
        ].join('\n'),
    });
}

// Sent AFTER a password actually changes. OWASP's Forgot Password guidance: "Send the
// user an email informing them that their password has been reset (do not send the
// password in the email!)". This is the control that turns a silent account takeover
// into something the real owner notices, so it deliberately carries no link to click
// (a "wasn't me" link would just be another thing to phish).
async function sendPasswordChanged({ to }) {
    await sendEmail({
        to,
        subject: 'Your Resume Creator password was changed',
        text: [
            'The password for this Resume Creator account was just changed, and every',
            'signed-in device has been logged out.',
            '',
            "If you did this, nothing more is needed.",
            '',
            "If you did NOT do this, someone else may have access to your email account.",
            'Reset your password again from the login page and secure your email first.',
            '',
        ].join('\n'),
    });
}

module.exports = { sendEmail, sendPasswordReset, sendPasswordChanged };
