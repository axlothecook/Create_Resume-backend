const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startTestApp, stopTestApp, clearDb, makeUser } = require('./helpers');

// Login must not reveal WHICH emails have accounts (ASVS 6.3.8): not through the
// message, not through the status code, and not through response time.
//
// Timing is asserted by MECHANISM, not by clock: a wall-clock assertion would be
// flaky on a shared CI runner. Instead we prove the expensive work actually happens
// on the unknown-email path, which is the thing that equalises the timing.

let app;
beforeAll(async () => { app = await startTestApp(); });
afterAll(async () => { await stopTestApp(); });
afterEach(async () => { await clearDb(); jest.restoreAllMocks(); });

describe('login does not leak which accounts exist', () => {
    test('unknown email and wrong password are indistinguishable in the response', async () => {
        const { creds } = await makeUser(app);

        const wrongPassword = await request(app).post('/auth/login')
            .send({ email: creds.email, password: 'definitelywrong123' });
        const unknownEmail = await request(app).post('/auth/login')
            .send({ email: 'nobody-here@example.com', password: 'definitelywrong123' });

        expect(wrongPassword.status).toBe(401);
        expect(unknownEmail.status).toBe(wrongPassword.status);
        expect(unknownEmail.body).toEqual(wrongPassword.body);
    });

    test('an unknown email still performs a bcrypt comparison (equal work)', async () => {
        const compare = jest.spyOn(bcrypt, 'compare');

        await request(app).post('/auth/login')
            .send({ email: 'nobody-here@example.com', password: 'definitelywrong123' })
            .expect(401);

        // The dummy verify ran. Without it this path would short-circuit and return
        // far faster than a real account, which is the enumeration oracle.
        expect(compare).toHaveBeenCalledTimes(1);
    });

    test('a known email performs the same single comparison', async () => {
        const { creds } = await makeUser(app);
        const compare = jest.spyOn(bcrypt, 'compare');

        await request(app).post('/auth/login')
            .send({ email: creds.email, password: 'definitelywrong123' })
            .expect(401);

        expect(compare).toHaveBeenCalledTimes(1);
    });

    test('the real password still works (the dummy path did not break login)', async () => {
        const { creds } = await makeUser(app);
        await request(app).post('/auth/login')
            .send({ email: creds.email, password: creds.password })
            .expect(200);
    });
});
