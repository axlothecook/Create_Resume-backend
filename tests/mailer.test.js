const { sendEmail, sendPasswordReset, sendPasswordChanged } = require('../src/lib/mailer');

// Unit tests for the Brevo mailer. global.fetch is stubbed so the REAL send branch is
// exercised WITHOUT a live Brevo account or a network call.

const ORIGINAL_KEY = process.env.BREVO_API_KEY;
const ORIGINAL_FROM = process.env.EMAIL_FROM;

function restore(name, value) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

afterEach(() => {
    restore('BREVO_API_KEY', ORIGINAL_KEY);
    restore('EMAIL_FROM', ORIGINAL_FROM);
    jest.restoreAllMocks();
    delete global.fetch;
});

// Configured mode: both env vars present.
function configure() {
    process.env.BREVO_API_KEY = 'test-key-123';
    process.env.EMAIL_FROM = 'noreply@example.com';
}

describe('mailer — not configured (console fallback)', () => {
    beforeEach(() => {
        delete process.env.BREVO_API_KEY;
        delete process.env.EMAIL_FROM;
        global.fetch = jest.fn();
    });

    test('logs instead of sending, and never throws', async () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        await expect(sendEmail({ to: 'a@b.test', subject: 'Hi', text: 'Body' })).resolves.toBeUndefined();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalled();
        expect(log.mock.calls[0][0]).toContain('a@b.test');
    });

    test('the reset link still reaches the console, which is how dev uses it', async () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        await sendPasswordReset({ to: 'user@example.com', url: 'http://localhost:5173/reset-password?token=abc' });
        expect(log.mock.calls[0][0]).toContain('token=abc');
    });

    test('a HALF-configured setup also falls back rather than sending badly', async () => {
        // Only the key, no sender: Brevo would reject this, so it must not be attempted.
        process.env.BREVO_API_KEY = 'test-key-123';
        jest.spyOn(console, 'log').mockImplementation(() => {});
        await sendEmail({ to: 'a@b.test', subject: 'Hi', text: 'Body' });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('mailer — configured (real Brevo branch)', () => {
    beforeEach(configure);

    test('POSTs to the Brevo endpoint with the right headers and body', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201 });

        await sendEmail({ to: 'user@example.com', subject: 'Subject line', text: 'Body text' });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.brevo.com/v3/smtp/email');
        expect(init.method).toBe('POST');
        expect(init.headers['api-key']).toBe('test-key-123');
        expect(init.headers['content-type']).toBe('application/json; charset=utf-8');

        const body = JSON.parse(init.body);
        expect(body).toEqual({
            sender: { email: 'noreply@example.com' },
            to: [{ email: 'user@example.com' }],
            subject: 'Subject line',
            textContent: 'Body text',
        });
    });

    test('throws when Brevo returns a non-2xx, so the caller can log it', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => 'Bad sender',
        });
        await expect(sendEmail({ to: 'a@b.test', subject: 'x', text: 'y' }))
            .rejects.toThrow(/Brevo send failed \(400\)/);
    });

    test('the reset email carries the link and the 15-minute validity', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201 });
        const url = 'https://resume.axlothecook.com/reset-password?token=deadbeef';

        await sendPasswordReset({ to: 'user@example.com', url });

        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.to).toEqual([{ email: 'user@example.com' }]);
        expect(body.textContent).toContain(url);
        expect(body.textContent).toMatch(/15 minutes/);
    });

    test('the change notification names no password and offers no link to click', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201 });

        await sendPasswordChanged({ to: 'user@example.com' });

        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.subject).toMatch(/password was changed/i);
        // OWASP: never mail the password itself. And no link, so the warning mail
        // can't be turned into a phishing template.
        expect(body.textContent).not.toMatch(/https?:\/\//);
        expect(body.textContent).toMatch(/logged out/i);
    });
});
