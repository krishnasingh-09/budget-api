import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const recurringRouter = Router();
recurringRouter.use(authMiddleware);

type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const RecurringSchema = z.object({
  amount: z.number().positive(),
  description: z.string().min(1).max(255),
  type: z.enum(['income', 'expense']),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'yearly']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
});

function initRecurringTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
      start_date TEXT NOT NULL,
      end_date TEXT,
      last_generated TEXT,
      next_due TEXT NOT NULL,
      category_id TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
  `);
}

function calculateNextDue(date: string, frequency: Frequency): string {
  const d = new Date(date);
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d.toISOString().split('T')[0];
}

function generateDueTransactions(userId: string): number {
  initRecurringTable();
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const due = db.prepare(`
    SELECT * FROM recurring_transactions
    WHERE user_id = ? AND is_active = 1 AND next_due <= ?
    AND (end_date IS NULL OR next_due <= end_date)
  `).all(userId, today) as any[];

  let generated = 0;

  const processAll = db.transaction(() => {
    for (const r of due) {
      const txId = uuidv4();
      db.prepare(`
        INSERT INTO transactions (id, user_id, category_id, amount, description, type, date, is_recurring, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(txId, userId, r.category_id, r.amount, r.description, r.type, r.next_due, r.notes);

      const nextDue = calculateNextDue(r.next_due, r.frequency as Frequency);
      db.prepare(`
        UPDATE recurring_transactions
        SET last_generated = ?, next_due = ?
        WHERE id = ?
      `).run(r.next_due, nextDue, r.id);

      generated++;
    }
  });

  processAll();
  return generated;
}

// GET /recurring
recurringRouter.get('/', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const db = getDb();
  const userId = req.userId!;

  const isActive = req.query.active as string | undefined;
  let query = 'SELECT * FROM recurring_transactions WHERE user_id = ?';
  const params: any[] = [userId];

  if (isActive === 'true') {
    query += ' AND is_active = 1';
  } else if (isActive === 'false') {
    query += ' AND is_active = 0';
  }

  query += ' ORDER BY next_due ASC';
  const recurring = db.prepare(query).all(...params) as any[];

  const today = new Date().toISOString().split('T')[0];
  const result = recurring.map((r) => ({
    ...r,
    is_overdue: r.next_due < today && r.is_active === 1,
    days_until_due: Math.ceil(
      (new Date(r.next_due).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
    ),
  }));

  res.json(result);
});

// GET /recurring/:id
recurringRouter.get('/:id', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const db = getDb();
  const r = db
    .prepare('SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!r) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }

  const history = db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ? AND description = ? AND is_recurring = 1
    ORDER BY date DESC LIMIT 10
  `).all(req.userId!, r.description) as any[];

  res.json({ ...r, recent_history: history });
});

// POST /recurring
recurringRouter.post('/', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const parsed = RecurringSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const { amount, description, type, frequency, start_date, end_date, category_id, notes } = parsed.data;

  if (end_date && end_date <= start_date) {
    res.status(400).json({ error: 'end_date must be after start_date' });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  const nextDue = start_date;

  db.prepare(`
    INSERT INTO recurring_transactions
    (id, user_id, amount, description, type, frequency, start_date, end_date, next_due, category_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId!, amount, description, type, frequency, start_date, end_date ?? null, nextDue, category_id ?? null, notes ?? null);

  const created = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(id);
  res.status(201).json(created);
});

// PUT /recurring/:id
recurringRouter.put('/:id', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }

  const parsed = RecurringSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(updates).map((v) =>
    typeof v === 'boolean' ? (v ? 1 : 0) : v
  );

  db.prepare(`UPDATE recurring_transactions SET ${fields} WHERE id = ? AND user_id = ?`)
    .run(...values, req.params.id, req.userId!);

  const updated = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// POST /recurring/generate — manually trigger generation
recurringRouter.post('/generate', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const count = generateDueTransactions(req.userId!);
  res.json({ generated: count, message: `Generated ${count} transaction(s)` });
});

// PUT /recurring/:id/pause
recurringRouter.put('/:id/pause', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!existing) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }

  if (existing.is_active === 0) {
    res.status(400).json({ error: 'Recurring transaction is already paused' });
    return;
  }

  db.prepare('UPDATE recurring_transactions SET is_active = 0 WHERE id = ?').run(req.params.id);
  const updated = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// PUT /recurring/:id/resume
recurringRouter.put('/:id/resume', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!existing) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }

  if (existing.is_active === 1) {
    res.status(400).json({ error: 'Recurring transaction is already active' });
    return;
  }

  db.prepare('UPDATE recurring_transactions SET is_active = 1 WHERE id = ?').run(req.params.id);
  const updated = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /recurring/:id
recurringRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  initRecurringTable();
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }

  db.prepare('DELETE FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId!);
  res.status(204).send();
});