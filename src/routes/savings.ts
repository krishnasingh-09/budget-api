import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const savingsRouter = Router();
savingsRouter.use(authMiddleware);

const SavingsGoalSchema = z.object({
  name: z.string().min(1).max(100),
  target_amount: z.number().positive(),
  current_amount: z.number().min(0).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const ContributionSchema = z.object({
  amount: z.number().positive(),
  note: z.string().max(255).optional(),
});

function initSavingsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_amount REAL NOT NULL,
      current_amount REAL NOT NULL DEFAULT 0,
      deadline TEXT,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#10b981',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS savings_contributions (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (goal_id) REFERENCES savings_goals(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

// GET /savings
savingsRouter.get('/', (req: AuthRequest, res: Response) => {
  initSavingsTable();
  const db = getDb();
  const userId = req.userId!;
  const status = req.query.status as string | undefined;

  let query = 'SELECT * FROM savings_goals WHERE user_id = ?';
  const params: any[] = [userId];

  if (status && ['active', 'completed', 'cancelled'].includes(status)) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';
  const goals = db.prepare(query).all(...params) as any[];

  const result = goals.map((g) => {
    const percentage = g.target_amount > 0
      ? Math.round((g.current_amount / g.target_amount) * 100)
      : 0;

    const remaining = g.target_amount - g.current_amount;

    let daysLeft: number | null = null;
    let dailyRequired: number | null = null;
    if (g.deadline) {
      const today = new Date();
      const deadline = new Date(g.deadline);
      daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      dailyRequired = daysLeft > 0 && remaining > 0
        ? Math.round((remaining / daysLeft) * 100) / 100
        : null;
    }

    return {
      ...g,
      percentage_complete: percentage,
      remaining_amount: remaining,
      days_left: daysLeft,
      daily_required: dailyRequired,
      is_overdue: g.deadline ? new Date(g.deadline) < new Date() && g.status === 'active' : false,
    };
  });

  res.json(result);
});

// GET /savings/:id
savingsRouter.get('/:id', (req: AuthRequest, res: Response) => {
  initSavingsTable();
  const db = getDb();
  const goal = db
    .prepare('SELECT * FROM savings_goals WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!goal) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }

  const contributions = db
    .prepare('SELECT * FROM savings_contributions WHERE goal_id = ? ORDER BY date DESC')
    .all(req.params.id) as any[];

  const percentage = goal.target_amount > 0
    ? Math.round((goal.current_amount / goal.target_amount) * 100)
    : 0;

  res.json({
    ...goal,
    percentage_complete: percentage,
    remaining_amount: goal.target_amount - goal.current_amount,
    contributions,
  });
});

// POST /savings
savingsRouter.post('/', (req: AuthRequest, res: Response) => {
  initSavingsTable();
  const parsed = SavingsGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const { name, target_amount, current_amount, deadline, description, color } = parsed.data;
  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO savings_goals (id, user_id, name, target_amount, current_amount, deadline, description, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId!, name, target_amount, current_amount ?? 0, deadline ?? null, description ?? null, color ?? '#10b981');

  const goal = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(id);
  res.status(201).json(goal);
});

// PUT /savings/:id
savingsRouter.put('/:id', (req: AuthRequest, res: Response) => {
  initSavingsTable();
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM savings_goals WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }

  const parsed = SavingsGoalSchema.partial().safeParse(req.body);
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
  const values = Object.values(updates);

  db.prepare(`UPDATE savings_goals SET ${fields}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(...values, req.params.id, req.userId!);

  const updated = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// POST /savings/:id/contribute
savingsRouter.post('/:id/contribute', (req: AuthRequest, res: Response) => {
  initSavingsTable();
  const parsed = ContributionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const db = getDb();
  const goal = db
    .prepare('SELECT * FROM savings_goals WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!goal) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }

  if (goal.status !== 'active') {
    res.status(400).json({ error: 'Cannot contribute to a non-active goal' });
    return;
  }

  const { amount, note } = parsed.data;
  const newAmount = goal.current_amount + amount;
  const id = uuidv4();

  const contribute = db.transaction(() => {
    db.prepare(`
      INSERT INTO savings_contributions (id, goal_id, user_id, amount, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.params.id, req.userId!, amount, note ?? null);

    db.prepare(`
      UPDATE savings_goals 
      SET current_amount = ?, 
          status = CASE WHEN ? >= target_amount THEN 'completed' ELSE status END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newAmount, newAmount, req.params.id);
  });

  contribute();

  const updated = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(req.params.id) as any;
  res.json({
    ...updated,
    percentage_complete: Math.round((updated.current_amount / updated.target_amount) * 100),
    contribution_id: id,
  });
});

// DELETE /savings/:id
savingsRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  initSavingsTable();
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM savings_goals WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }

  db.prepare('DELETE FROM savings_goals WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId!);
  res.status(204).send();
});

// PUT /savings/:id/cancel
savingsRouter.put('/:id/cancel', (req: AuthRequest, res: Response) => {
  initSavingsTable();
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM savings_goals WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!existing) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }

  if (existing.status !== 'active') {
    res.status(400).json({ error: 'Only active goals can be cancelled' });
    return;
  }

  db.prepare(`UPDATE savings_goals SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`)
    .run(req.params.id);

  const updated = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(req.params.id);
  res.json(updated);
});