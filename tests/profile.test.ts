import { request, setupTestDb, createUserAndLogin, authHeader } from './helpers';

setupTestDb();

describe('Profile API', () => {
  let token: string;

  beforeEach(async () => {
    ({ token } = await createUserAndLogin());
  });

  it('GET /profile returns user with stats', async () => {
    const res = await request.get('/profile').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@example.com');
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.transaction_count).toBe(0);
  });

  it('PUT /profile updates name', async () => {
    const res = await request.put('/profile')
      .set(authHeader(token))
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('PUT /profile/password rejects wrong current password', async () => {
    const res = await request.put('/profile/password')
      .set(authHeader(token))
      .send({ current_password: 'wrongpass', new_password: 'newpassword123' });
    expect(res.status).toBe(401);
  });

  it('PUT /profile/password rejects same password', async () => {
    const res = await request.put('/profile/password')
      .set(authHeader(token))
      .send({ current_password: 'password123', new_password: 'password123' });
    expect(res.status).toBe(400);
  });
});