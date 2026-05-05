import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const transactionRouter = Router();
transactionRouter.use(authMiddleware);

const TransactionSchema = z.object({
  amount: z.number().positive(),
  description: z.string().min(1).max(255),
  type: z.enum(['income', 'expense']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category_id: z.string().uuid().optional(),
  is_recurring: z.boolean().optional(),
   notes: z.string().max(500).optional(),
});

// GET /transactions — with pagination, filtering, date range
transactionRouter.get('/', (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const db = getDb();

  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  if (page < 1) {
    res.status(400).json({ error: 'page must be a positive integer' });
    return;
  }
  if (limit < 1 || limit > 100) {
    res.status(400).json({ error: 'limit must be between 1 and 100' });
    return;
  }

  const offset = (page - 1) * limit;

  // Filters
  const type = req.query.type as string | undefined;
  const categoryId = req.query.category_id as string | undefined;
  const startDate = req.query.start_date as string | undefined;
  const endDate = req.query.end_date as string | undefined;
  const search = req.query.search as string | undefined;
  const recurring = req.query.recurring as string | undefined;

  let query = 'SELECT * FROM transactions WHERE user_id = ?';
  const params: any[] = [userId];

  if (type && ['income', 'expense'].includes(type)) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (categoryId) {
    query += ' AND category_id = ?';
    params.push(categoryId);
  }
  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }
  if (search) {
    query += ' AND description LIKE ?';
    params.push(`%${search}%`);
  }
  if (recurring === 'true') {
    query += ' AND is_recurring = 1';
  } else if (recurring === 'false') {
    query += ' AND is_recurring = 0';
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
  const total = (db.prepare(countQuery).get(...params) as { count: number }).count;

  query += ' ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const transactions = db.prepare(query).all(...params);

  res.json({
    data: transactions,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// GET /transactions/:id
transactionRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const tx = db
    .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!tx) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }
  res.json(tx);
});

// POST /transactions
transactionRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = TransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const { amount, description, type, date, category_id, is_recurring, notes } = parsed.data;
  const db = getDb();

  if (category_id) {
    const cat = db
      .prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
      .get(category_id, req.userId!);
    if (!cat) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
  }

  const id = uuidv4();
  db.prepare(
  'INSERT INTO transactions (id, user_id, category_id, amount, description, type, date, is_recurring, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
).run(id, req.userId!, category_id ?? null, amount, description, type, date, is_recurring ? 1 : 0, notes ?? null);

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  res.status(201).json(tx);
});

// PUT /transactions/:id
transactionRouter.put('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!existing) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  const parsed = TransactionSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const updates = parsed.data;
  const fields = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(', ');
  const values = Object.values(updates).map((v) =>
    typeof v === 'boolean' ? (v ? 1 : 0) : v
  );

  if (fields.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  db.prepare(
    `UPDATE transactions SET ${fields} WHERE id = ? AND user_id = ?`
  ).run(...values, req.params.id, req.userId!);

  const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /transactions/:id
transactionRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.userId!
  );
  res.status(204).send();
});

// GET /transactions/export?type=expense&start_date=2024-01-01
transactionRouter.get('/export', (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const db = getDb();

  const type = req.query.type as string | undefined;
  const startDate = req.query.start_date as string | undefined;
  const endDate = req.query.end_date as string | undefined;

  let query = 'SELECT * FROM transactions WHERE user_id = ?';
  const params: any[] = [userId];

  if (type && ['income', 'expense'].includes(type)) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    res.status(400).json({ error: `Invalid start_date: "${startDate}". Expected format YYYY-MM-DD` });
    return;
  }
  query += ' AND date >= ?';
  params.push(startDate);
}
if (endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    res.status(400).json({ error: `Invalid end_date: "${endDate}". Expected format YYYY-MM-DD` });
    return;
  }
  query += ' AND date <= ?';
  params.push(endDate);
}

  query += ' ORDER BY date DESC';

  const transactions = db.prepare(query).all(...params) as any[];

  // Build CSV
  const headers = ['id', 'amount', 'description', 'type', 'date', 'is_recurring', 'notes'];
  const rows = transactions.map((t) =>
  headers.map((h) => {
    const val = String(t[h] ?? '').replace(/\n/g, ' ').replace(/\r/g, '');
    return val.includes(',') ? `"${val}"` : val;
  }).join(',')
);

  const csv = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(csv);
});