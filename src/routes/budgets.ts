import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const budgetRouter = Router();
budgetRouter.use(authMiddleware);

const BudgetSchema = z.object({
  category_id: z.string().uuid(),
  amount: z.number().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

// GET /budgets?month=2024-03
budgetRouter.get('/', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const userId = req.userId!;
  const month = req.query.month as string | undefined;

  let query = `
    SELECT b.*, c.name as category_name, c.color as category_color,
      COALESCE((
        SELECT SUM(t.amount) 
        FROM transactions t 
        WHERE t.category_id = b.category_id 
          AND t.user_id = b.user_id 
          AND t.type = 'expense'
          AND t.date LIKE b.month || '%'
      ), 0) as spent
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.user_id = ?
  `;
  const params: any[] = [userId];

  if (month) {
    query += ' AND b.month = ?';
    params.push(month);
  }

  query += ' ORDER BY b.month DESC, c.name ASC';

  const budgets = db.prepare(query).all(...params) as any[];
  const result = budgets.map((b) => ({
  ...b,
  remaining: b.amount - b.spent,
  over_budget: b.spent > b.amount,
  percentage_used: b.amount > 0 ? Math.round((b.spent / b.amount) * 100) : 0,
  alert: b.amount > 0 && (b.spent / b.amount) >= 0.8 ? 'warning' : null,
}));

  res.json(result);
});

// POST /budgets
budgetRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = BudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const { category_id, amount, month } = parsed.data;
  const db = getDb();
  const userId = req.userId!;

  const category = db
    .prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .get(category_id, userId);
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?')
    .get(userId, category_id, month);
  if (existing) {
    res.status(409).json({ error: 'Budget already exists for this category and month' });
    return;
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO budgets (id, user_id, category_id, amount, month) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, category_id, amount, month);

  const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  res.status(201).json(budget);
});

// PUT /budgets/:id
budgetRouter.put('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Budget not found' });
    return;
  }

  const parsed = z.object({ amount: z.number().positive() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }

  db.prepare('UPDATE budgets SET amount = ? WHERE id = ? AND user_id = ?').run(
    parsed.data.amount,
    req.params.id,
    req.userId!
  );

  const updated = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /budgets/:id
budgetRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM budgets WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Budget not found' });
    return;
  }

  db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.userId!);
  res.status(204).send();
});
