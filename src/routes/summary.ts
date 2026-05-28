import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const summaryRouter = Router();
summaryRouter.use(authMiddleware);

// GET /summary/monthly?month=2024-03
// Returns income, expenses, net, and per-category breakdown for a month
summaryRouter.get('/monthly', (req: AuthRequest, res: Response) => {
  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'month parameter required in YYYY-MM format' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;
  const startDate = `${month}-01`;

  // Calculate end of month correctly
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const totals = db.prepare(`
    SELECT 
      type,
      SUM(amount) as total
    FROM transactions
    WHERE user_id = ? AND date >= ? AND date <= ?
    GROUP BY type
  `).all(userId, startDate, endDate) as { type: string; total: number }[];

  const income = totals.find((r) => r.type === 'income')?.total ?? 0;
  const expenses = totals.find((r) => r.type === 'expense')?.total ?? 0;
  const net = income - expenses;

  const byCategory = db.prepare(`
    SELECT 
      c.id,
      c.name,
      c.color,
      c.budget_limit,
      SUM(t.amount) as spent
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ? AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
    GROUP BY t.category_id
    ORDER BY spent DESC
  `).all(userId, startDate, endDate) as any[];

  // Count transactions for the month
const txCount = db.prepare(`
  SELECT COUNT(*) as count FROM transactions
  WHERE user_id = ? AND date >= ? AND date <= ?
`).get(userId, startDate, endDate) as { count: number };

res.json({
  month,
  income,
  expenses,
  net,
  transaction_count: txCount.count,
  by_category: byCategory.map((c) => ({
    ...c,
    budget_remaining: c.budget_limit != null ? c.budget_limit - c.spent : null,
    over_budget: c.budget_limit != null ? c.spent > c.budget_limit : false,
  })),
});
});

// GET /summary/range?start_date=2024-01-01&end_date=2024-03-31
summaryRouter.get('/range', (req: AuthRequest, res: Response) => {
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;

  if (!startDate || !endDate) {
    res.status(400).json({ error: 'start_date and end_date are required' });
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  res.status(400).json({ error: `Invalid start_date: "${startDate}". Expected format YYYY-MM-DD` });
  return;
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
  res.status(400).json({ error: `Invalid end_date: "${endDate}". Expected format YYYY-MM-DD` });
  return;
}

  if (startDate > endDate) {
  res.status(400).json({ 
    error: `start_date (${startDate}) must be before or equal to end_date (${endDate})` 
  });
  return;
}

  const db = getDb();
  const userId = req.userId!;

  const totals = db.prepare(`
    SELECT type, SUM(amount) as total, COUNT(*) as count
    FROM transactions
    WHERE user_id = ? AND date >= ? AND date <= ?
    GROUP BY type
  `).all(userId, startDate, endDate) as { type: string; total: number; count: number }[];

  const income = totals.find((r) => r.type === 'income')?.total ?? 0;
  const expenses = totals.find((r) => r.type === 'expense')?.total ?? 0;
  const incomeCount = totals.find((r) => r.type === 'income')?.count ?? 0;
  const expenseCount = totals.find((r) => r.type === 'expense')?.count ?? 0;

  // Daily average spending
  const dayDiff = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  res.json({
    start_date: startDate,
    end_date: endDate,
    days: dayDiff,
    income,
    expenses,
    net: income - expenses,
    transaction_count: incomeCount + expenseCount,
    daily_avg_expense: dayDiff > 0 ? Math.round((expenses / dayDiff) * 100) / 100 : 0,
  });
});

// GET /summary/top-categories?month=2024-03&limit=5
summaryRouter.get('/top-categories', (req: AuthRequest, res: Response) => {
  const month = req.query.month as string;
  const limit = parseInt(req.query.limit as string) || 5;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'month parameter required in YYYY-MM format' });
    return;
  }

  if (limit < 1 || limit > 20) {
    res.status(400).json({ error: 'limit must be between 1 and 20' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;
  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const results = db.prepare(`
    SELECT 
      COALESCE(c.name, 'Uncategorized') as category,
      COALESCE(c.color, '#94a3b8') as color,
      SUM(t.amount) as total,
      COUNT(*) as count
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ? AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
    GROUP BY t.category_id
    ORDER BY total DESC
    LIMIT ?
  `).all(userId, startDate, endDate, limit);

  res.json(results);
});

// GET /summary/yearly?year=2024
summaryRouter.get('/yearly', (req: AuthRequest, res: Response) => {
  const year = req.query.year as string;

  if (!year || !/^\d{4}$/.test(year)) {
    res.status(400).json({ error: 'year parameter required in YYYY format' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;

  // Get monthly breakdown for the year
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, '0');
    return `${year}-${month}`;
  });

  const breakdown = months.map((month) => {
    const startDate = `${month}-01`;
    const lastDay = new Date(
  parseInt(year),
  parseInt(month.split('-')[1]) - 1 + 1,
  0
).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const totals = db.prepare(`
      SELECT type, SUM(amount) as total
      FROM transactions
      WHERE user_id = ? AND date >= ? AND date <= ?
      GROUP BY type
    `).all(userId, startDate, endDate) as { type: string; total: number }[];

    const income = totals.find((r) => r.type === 'income')?.total ?? 0;
    const expenses = totals.find((r) => r.type === 'expense')?.total ?? 0;

    return { month, income, expenses, net: income - expenses };
  });

  const totalIncome = breakdown.reduce((sum, m) => sum + m.income, 0);
  const totalExpenses = breakdown.reduce((sum, m) => sum + m.expenses, 0);

  res.json({
    year,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net: totalIncome - totalExpenses,
    monthly_breakdown: breakdown,
  });
});