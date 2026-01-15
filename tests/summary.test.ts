import { request, setupTestDb, createUserAndLogin, authHeader } from './helpers';

setupTestDb();

describe('Summary API', () => {
  let token: string;

  beforeEach(async () => {
    ({ token } = await createUserAndLogin());
  });

  describe('GET /summary/monthly', () => {
    it('returns monthly totals', async () => {
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 1000, description: 'Salary', type: 'income', date: '2024-03-01' });
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 200, description: 'Rent', type: 'expense', date: '2024-03-05' });
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 50, description: 'Food', type: 'expense', date: '2024-03-10' });

      const res = await request.get('/summary/monthly?month=2024-03').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.income).toBe(1000);
      expect(res.body.expenses).toBe(250);
      expect(res.body.net).toBe(750);
    });

    it('excludes transactions outside the month', async () => {
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 500, description: 'Feb income', type: 'income', date: '2024-02-28' });
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 100, description: 'Mar income', type: 'income', date: '2024-03-01' });

      const res = await request.get('/summary/monthly?month=2024-03').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.income).toBe(100);
    });

    it('returns 400 for invalid month format', async () => {
      const res = await request.get('/summary/monthly?month=2024-3').set(authHeader(token));
      expect(res.status).toBe(400);
    });

    it('handles months with 31 days correctly', async () => {
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 100, description: 'Jan 31', type: 'expense', date: '2024-01-31' });
      const res = await request.get('/summary/monthly?month=2024-01').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.expenses).toBe(100);
    });
  });

  describe('GET /summary/range', () => {
    it('calculates daily average correctly', async () => {
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 30, description: 'Day 1', type: 'expense', date: '2024-03-01' });
      await request.post('/transactions').set(authHeader(token))
        .send({ amount: 70, description: 'Day 3', type: 'expense', date: '2024-03-03' });

      const res = await request
        .get('/summary/range?start_date=2024-03-01&end_date=2024-03-03')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.expenses).toBe(100);
      expect(res.body.days).toBe(3);
      expect(res.body.daily_avg_expense).toBeCloseTo(33.33, 1);
    });

    it('returns 400 if start_date is after end_date', async () => {
      const res = await request
        .get('/summary/range?start_date=2024-03-31&end_date=2024-03-01')
        .set(authHeader(token));
      expect(res.status).toBe(400);
    });
  });
});
