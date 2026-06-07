const request = require('supertest');
const { startTestApp, stopTestApp, clearDb, makeUser } = require('./helpers');

let app;
beforeAll(async () => { app = await startTestApp(); });
afterAll(async () => { await stopTestApp(); });
afterEach(async () => { await clearDb(); });

// A representative "full editor state" payload.
const fullState = {
    personalDetails: [{ id: '', fullname: 'Clea Desandre', email: 'c@x.fr', phoneNumber: '33 1', address: 'Paris' }],
    educationArray: [{ id: -1, title: 'Uni', subtitle: 'BA', description: [{ id: -2, text: 'bullet' }] }],
    experienceArray: [{ id: -2, title: 'Co', subtitle: 'role', description: [] }],
    skillArray: [{ id: -1, skillList: [{ id: -2, text: 'painting' }], languageList: [{ id: -3, text: 'French' }] }],
    projectArray: [{ id: -1, title: 'Proj', links: [{ id: -2, text: 'url' }], description: [] }],
    style: { color: '#607480', font: 'Roboto', gridView: false, underlined: false, personalInfoBox: 'personal-info-box-no-side-padding' },
    sectionOrder: ['project', 'experience', 'skill', 'education'],
};

describe('résumé CRUD — guest / auth guard', () => {
    test.each(['get', 'post', 'put', 'delete'])('guest cannot %s résumés (401)', async (method) => {
        const path = method === 'get' || method === 'post' ? '/resumes' : '/resumes/000000000000000000000000';
        const res = await request(app)[method](path).send({});
        expect(res.status).toBe(401);
    });
});

describe('résumé CRUD — happy paths', () => {
    test('list is empty for a new user, with count + max', async () => {
        const { agent } = await makeUser(app);
        const res = await agent.get('/resumes');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ resumes: [], count: 0, max: 5 });
    });

    test('create stores the résumé and returns 201 + envelope', async () => {
        const { agent } = await makeUser(app);
        const res = await agent.post('/resumes').send({ title: 'My CV', data: fullState });
        expect(res.status).toBe(201);
        expect(res.body.resume).toMatchObject({ title: 'My CV' });
        expect(res.body.resume.id).toBeDefined();
        expect(res.body.resume.createdAt).toBeDefined();
    });

    test('GET returns the COMPLETE full editor state verbatim (the download round-trip)', async () => {
        const { agent } = await makeUser(app);
        const created = await agent.post('/resumes').send({ title: 'RT', data: fullState });
        const id = created.body.resume.id;
        const res = await agent.get(`/resumes/${id}`);
        expect(res.status).toBe(200);
        // Deep-equality: what we saved is exactly what we can load/download.
        expect(res.body.resume.data).toEqual(fullState);
        expect(res.body.resume.title).toBe('RT');
    });

    test('list reflects created résumés (lightweight: no data blob) newest-first', async () => {
        const { agent } = await makeUser(app);
        await agent.post('/resumes').send({ title: 'first' });
        await agent.post('/resumes').send({ title: 'second' });
        const res = await agent.get('/resumes');
        expect(res.body.count).toBe(2);
        expect(res.body.resumes[0].title).toBe('second'); // newest first
        expect(res.body.resumes[0].data).toBeUndefined(); // list is lightweight
    });

    test('update changes title + data', async () => {
        const { agent } = await makeUser(app);
        const created = await agent.post('/resumes').send({ title: 'old', data: { a: 1 } });
        const id = created.body.resume.id;
        const res = await agent.put(`/resumes/${id}`).send({ title: 'new', data: { a: 2, b: 3 } });
        expect(res.status).toBe(200);
        expect(res.body.resume.title).toBe('new');
        expect(res.body.resume.data).toEqual({ a: 2, b: 3 });
    });

    test('delete removes the résumé; subsequent GET is 404', async () => {
        const { agent } = await makeUser(app);
        const created = await agent.post('/resumes').send({ title: 'gone' });
        const id = created.body.resume.id;
        await agent.delete(`/resumes/${id}`).expect(200);
        await agent.get(`/resumes/${id}`).expect(404);
    });
});

describe('résumé CRUD — guards & limits', () => {
    test('ownership isolation: user B cannot get/update/delete user A’s résumé (404, not 403/200)', async () => {
        const { agent: a } = await makeUser(app, { email: 'ownerA@example.com' });
        const { agent: b } = await makeUser(app, { email: 'ownerB@example.com' });
        const created = await a.post('/resumes').send({ title: 'A secret', data: { secret: true } });
        const id = created.body.resume.id;

        await b.get(`/resumes/${id}`).expect(404);
        await b.put(`/resumes/${id}`).send({ title: 'hacked' }).expect(404);
        await b.delete(`/resumes/${id}`).expect(404);

        // B's list stays empty and A's résumé is untouched.
        const bList = await b.get('/resumes');
        expect(bList.body.count).toBe(0);
        const aGet = await a.get(`/resumes/${id}`);
        expect(aGet.body.resume.title).toBe('A secret');
    });

    test('max-5 cap: 6th create returns 409 and count stays 5', async () => {
        const { agent } = await makeUser(app);
        for (let i = 0; i < 5; i += 1) {
            await agent.post('/resumes').send({ title: `r${i}` }).expect(201);
        }
        const overflow = await agent.post('/resumes').send({ title: 'overflow' });
        expect(overflow.status).toBe(409);
        const list = await agent.get('/resumes');
        expect(list.body.count).toBe(5);
    });

    test('malformed ObjectId returns 404 (not a 500)', async () => {
        const { agent } = await makeUser(app);
        await agent.get('/resumes/not-a-valid-id').expect(404);
    });

    test('create with non-object data is rejected (400)', async () => {
        const { agent } = await makeUser(app);
        const res = await agent.post('/resumes').send({ title: 'bad', data: 'a string not object' });
        expect(res.status).toBe(400);
    });

    test('title over 120 chars is rejected (400)', async () => {
        const { agent } = await makeUser(app);
        const res = await agent.post('/resumes').send({ title: 'x'.repeat(121) });
        expect(res.status).toBe(400);
    });
});
