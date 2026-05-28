import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const alertRouter = Router();
alertRouter.use(authMiddleware);

// GET /alerts?month=2024-03
alertRouter.get('/', (req: AuthRequest, res: Response) => {
  const month = req.query.month as string;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'month parameter required in YYYY-MM format' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;

  const budgets = db.prepare(`
    SELECT b.*, c.name as category_name,
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
    WHERE b.user_id = ? AND b.month = ?
  `).all(userId, month) as any[];

  const alerts = budgets
    .filter((b) => b.amount > 0 && (b.spent / b.amount) >= 0.8)
    .map((b) => ({
      category: b.category_name,
      budget: b.amount,
      spent: b.spent,
      percentage_used: Math.round((b.spent / b.amount) * 100),
      status: b.spent >= b.amount ? 'over_budget' : 'warning',
    }));

  res.json({ month, alerts });
});