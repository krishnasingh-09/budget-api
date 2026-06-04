import { request, setupTestDb, createUserAndLogin, authHeader } from './helpers';

setupTestDb();

describe('Savings Goals API', () => {
  let token: string;

  beforeEach(async () => {
    ({ token } = await createUserAndLogin());
  });

  describe('POST /savings', () => {
    it('creates a savings goal', async () => {
      const res = await request.post('/savings').set(authHeader(token)).send({
        name: 'Emergency Fund',
        target_amount: 5000,
        current_amount: 500,
        deadline: '2026-12-31',
        color: '#10b981',
      });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Emergency Fund');
      expect(res.body.target_amount).toBe(5000);
      expect(res.body.current_amount).toBe(500);
    });

    it('rejects negative target amount', async () => {
      const res = await request.post('/savings').set(authHeader(token)).send({
        name: 'Bad Goal',
        target_amount: -100,
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid color format', async () => {
      const res = await request.post('/savings').set(authHeader(token)).send({
        name: 'Bad Color',
        target_amount: 1000,
        color: 'red',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /savings', () => {
    it('returns all savings goals', async () => {
      await request.post('/savings').set(authHeader(token))
        .send({ name: 'Goal 1', target_amount: 1000 });
      await request.post('/savings').set(authHeader(token))
        .send({ name: 'Goal 2', target_amount: 2000 });

      const res = await request.get('/savings').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('returns percentage_complete and remaining_amount', async () => {
      await request.post('/savings').set(authHeader(token))
        .send({ name: 'Goal', target_amount: 1000, current_amount: 250 });

      const res = await request.get('/savings').set(authHeader(token));
      expect(res.body[0].percentage_complete).toBe(25);
      expect(res.body[0].remaining_amount).toBe(750);
    });

    it('filters by status', async () => {
      await request.post('/savings').set(authHeader(token))
        .send({ name: 'Active Goal', target_amount: 1000 });

      const res = await request.get('/savings?status=active').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.every((g: any) => g.status === 'active')).toBe(true);
    });
  });

  describe('POST /savings/:id/contribute', () => {
    it('adds contribution and updates current_amount', async () => {
      const create = await request.post('/savings').set(authHeader(token))
        .send({ name: 'Fund', target_amount: 1000, current_amount: 0 });
      const id = create.body.id;

      const res = await request.post(`/savings/${id}/contribute`)
        .set(authHeader(token))
        .send({ amount: 300, note: 'Monthly savings' });

      expect(res.status).toBe(200);
      expect(res.body.current_amount).toBe(300);
      expect(res.body.percentage_complete).toBe(30);
    });

    it('marks goal as completed when target reached', async () => {
      const create = await request.post('/savings').set(authHeader(token))
        .send({ name: 'Fund', target_amount: 500, current_amount: 400 });
      const id = create.body.id;

      const res = await request.post(`/savings/${id}/contribute`)
        .set(authHeader(token))
        .send({ amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
    });

    it('rejects contribution to cancelled goal', async () => {
      const create = await request.post('/savings').set(authHeader(token))
        .send({ name: 'Fund', target_amount: 500 });
      const id = create.body.id;

      await request.put(`/savings/${id}/cancel`).set(authHeader(token));

      const res = await request.post(`/savings/${id}/contribute`)
        .set(authHeader(token))
        .send({ amount: 100 });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /savings/:id/cancel', () => {
    it('cancels an active goal', async () => {
      const create = await request.post('/savings').set(authHeader(token))
        .send({ name: 'Fund', target_amount: 500 });
      const id = create.body.id;

      const res = await request.put(`/savings/${id}/cancel`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('rejects cancelling already cancelled goal', async () => {
      const create = await request.post('/savings').set(authHeader(token))
        .send({ name: 'Fund', target_amount: 500 });
      const id = create.body.id;

      await request.put(`/savings/${id}/cancel`).set(authHeader(token));
      const res = await request.put(`/savings/${id}/cancel`).set(authHeader(token));
      expect(res.status).toBe(400);
    });
  });
});

describe('Recurring Transactions API', () => {
  let token: string;

  beforeEach(async () => {
    ({ token } = await createUserAndLogin());
  });

  describe('POST /recurring', () => {
    it('creates a recurring transaction', async () => {
      const res = await request.post('/recurring').set(authHeader(token)).send({
        amount: 1000,
        description: 'Monthly salary',
        type: 'income',
        frequency: 'monthly',
        start_date: '2026-01-01',
      });
      expect(res.status).toBe(201);
      expect(res.body.frequency).toBe('monthly');
      expect(res.body.is_active).toBe(1);
    });

    it('rejects invalid frequency', async () => {
      const res = await request.post('/recurring').set(authHeader(token)).send({
        amount: 100,
        description: 'Test',
        type: 'expense',
        frequency: 'hourly',
        start_date: '2026-01-01',
      });
      expect(res.status).toBe(400);
    });

    it('rejects end_date before start_date', async () => {
      const res = await request.post('/recurring').set(authHeader(token)).send({
        amount: 100,
        description: 'Test',
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-06-01',
        end_date: '2026-01-01',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /recurring', () => {
    it('returns all recurring transactions', async () => {
      await request.post('/recurring').set(authHeader(token)).send({
        amount: 100, description: 'Netflix', type: 'expense',
        frequency: 'monthly', start_date: '2026-01-01',
      });
      await request.post('/recurring').set(authHeader(token)).send({
        amount: 200, description: 'Spotify', type: 'expense',
        frequency: 'monthly', start_date: '2026-01-01',
      });

      const res = await request.get('/recurring').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('includes days_until_due field', async () => {
      await request.post('/recurring').set(authHeader(token)).send({
        amount: 100, description: 'Test', type: 'expense',
        frequency: 'monthly', start_date: '2026-12-01',
      });

      const res = await request.get('/recurring').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body[0]).toHaveProperty('days_until_due');
    });
  });

  describe('PUT /recurring/:id/pause and resume', () => {
    it('pauses an active recurring transaction', async () => {
      const create = await request.post('/recurring').set(authHeader(token)).send({
        amount: 100, description: 'Test', type: 'expense',
        frequency: 'monthly', start_date: '2026-01-01',
      });
      const id = create.body.id;

      const res = await request.put(`/recurring/${id}/pause`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.is_active).toBe(0);
    });

    it('resumes a paused recurring transaction', async () => {
      const create = await request.post('/recurring').set(authHeader(token)).send({
        amount: 100, description: 'Test', type: 'expense',
        frequency: 'monthly', start_date: '2026-01-01',
      });
      const id = create.body.id;

      await request.put(`/recurring/${id}/pause`).set(authHeader(token));
      const res = await request.put(`/recurring/${id}/resume`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.is_active).toBe(1);
    });

    it('rejects pausing already paused transaction', async () => {
      const create = await request.post('/recurring').set(authHeader(token)).send({
        amount: 100, description: 'Test', type: 'expense',
        frequency: 'monthly', start_date: '2026-01-01',
      });
      const id = create.body.id;

      await request.put(`/recurring/${id}/pause`).set(authHeader(token));
      const res = await request.put(`/recurring/${id}/pause`).set(authHeader(token));
      expect(res.status).toBe(400);
    });
  });
});

describe('Audit Log API', () => {
  let token: string;

  beforeEach(async () => {
    ({ token } = await createUserAndLogin());
  });

  it('GET /audit returns empty list initially', async () => {
    const res = await request.get('/audit').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /audit/summary returns summary stats', async () => {
    const res = await request.get('/audit/summary').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.total_actions).toBeDefined();
    expect(res.body.by_action).toBeDefined();
    expect(res.body.by_resource).toBeDefined();
  });

  it('GET /audit supports pagination', async () => {
    const res = await request.get('/audit?page=1&limit=5').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.limit).toBe(5);
  });

  it('GET /audit rejects invalid page', async () => {
    const res = await request.get('/audit?page=-1').set(authHeader(token));
    expect(res.status).toBe(400);
  });
});