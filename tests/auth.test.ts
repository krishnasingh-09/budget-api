import { request, setupTestDb } from './helpers';

setupTestDb();

describe('POST /auth/register', () => {
  it('registers a new user and returns token', async () => {
    const res = await request.post('/auth/register').send({
      email: 'user@example.com',
      password: 'password123',
      name: 'Alice',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('user@example.com');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('rejects duplicate email with 409', async () => {
    await request.post('/auth/register').send({ email: 'a@b.com', password: 'pass1234', name: 'A' });
    const res = await request.post('/auth/register').send({ email: 'a@b.com', password: 'pass1234', name: 'B' });
    expect(res.status).toBe(409);
  });

  it('rejects short password', async () => {
    const res = await request.post('/auth/register').send({ email: 'x@y.com', password: 'short', name: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials', async () => {
    await request.post('/auth/register').send({ email: 'login@test.com', password: 'pass1234', name: 'Login' });
    const res = await request.post('/auth/login').send({ email: 'login@test.com', password: 'pass1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects wrong password with 401', async () => {
    await request.post('/auth/register').send({ email: 'x@x.com', password: 'rightpass', name: 'X' });
    const res = await request.post('/auth/login').send({ email: 'x@x.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });
});
