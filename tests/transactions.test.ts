import { request, setupTestDb, createUserAndLogin, authHeader } from './helpers';

setupTestDb();

describe('Transactions API', () => {
  let token: string;

  beforeEach(async () => {
    ({ token } = await createUserAndLogin());
  });

  describe('POST /transactions', () => {
    it('creates a transaction', async () => {
      const res = await request
        .post('/transactions')
        .set(authHeader(token))
        .send({ amount: 50.5, description: 'Lunch', type: 'expense', date: '2024-03-15' });
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(50.5);
      expect(res.body.type).toBe('expense');
    });

    it('rejects negative amount', async () => {
      const res = await request
        .post('/transactions')
        .set(authHeader(token))
        .send({ amount: -10, description: 'Bad', type: 'expense', date: '2024-03-15' });
      expect(res.status).toBe(400);
    });

    it('rejects invalid date format', async () => {
      const res = await request
        .post('/transactions')
        .set(authHeader(token))
        .send({ amount: 10, description: 'Bad date', type: 'expense', date: '15-03-2024' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /transactions pagination', () => {
    beforeEach(async () => {
      // Create 5 transactions
      for (let i = 1; i <= 5; i++) {
        await request
          .post('/transactions')
          .set(authHeader(token))
          .send({ amount: i * 10, description: `Tx ${i}`, type: 'expense', date: `2024-03-${String(i).padStart(2, '0')}` });
      }
    });

    it('returns paginated results', async () => {
      const res = await request.get('/transactions?page=1&limit=2').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination.total).toBe(5);
      expect(res.body.pagination.pages).toBe(3);
    });

    it('returns 400 for negative page', async () => {
      const res = await request.get('/transactions?page=-1').set(authHeader(token));
      expect(res.status).toBe(400);
    });

    it('returns 400 for limit over 100', async () => {
      const res = await request.get('/transactions?limit=200').set(authHeader(token));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /transactions filtering', () => {
    beforeEach(async () => {
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 100, description: 'Salary', type: 'income', date: '2024-03-01' });
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 50, description: 'Groceries', type: 'expense', date: '2024-03-05' });
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 30, description: 'Coffee', type: 'expense', date: '2024-03-10' });
    });

    it('filters by type=income', async () => {
      const res = await request.get('/transactions?type=income').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: any) => t.type === 'income')).toBe(true);
      expect(res.body.data.length).toBe(1);
    });

    it('filters by date range', async () => {
      const res = await request
        .get('/transactions?start_date=2024-03-05&end_date=2024-03-05')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].description).toBe('Groceries');
    });
  });

  describe('PUT /transactions/:id', () => {
    it('updates a transaction', async () => {
      const create = await request.post('/transactions').set(authHeader(token))
        .send({ amount: 20, description: 'Old', type: 'expense', date: '2024-03-01' });
      const id = create.body.id;

      const res = await request.put(`/transactions/${id}`).set(authHeader(token))
        .send({ amount: 25, description: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(25);
      expect(res.body.description).toBe('Updated');
    });
  });

  describe('DELETE /transactions/:id', () => {
    it('deletes a transaction', async () => {
      const create = await request.post('/transactions').set(authHeader(token))
        .send({ amount: 10, description: 'Delete me', type: 'expense', date: '2024-03-01' });
      const id = create.body.id;

      const del = await request.delete(`/transactions/${id}`).set(authHeader(token));
      expect(del.status).toBe(204);

      const get = await request.get(`/transactions/${id}`).set(authHeader(token));
      expect(get.status).toBe(404);
    });
  });
});
