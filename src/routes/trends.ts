import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const trendsRouter = Router();
trendsRouter.use(authMiddleware);

// GET /trends/weekly?month=2024-03
// Returns daily spending breakdown for a month grouped by week
trendsRouter.get('/weekly', (req: AuthRequest, res: Response) => {
  const month = req.query.month as string;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'month parameter required in YYYY-MM format' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;
  const [year, mon] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const daily = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expenses,
      SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
      COUNT(*) as count
    FROM transactions
    WHERE user_id = ? AND date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(userId, startDate, endDate) as {
    date: string;
    expenses: number;
    income: number;
    count: number;
  }[];

  // Group into weeks
  const weeks: {
    week: number;
    start_date: string;
    end_date: string;
    expenses: number;
    income: number;
    days: typeof daily;
  }[] = [];

  let weekNum = 1;
  let weekStart = startDate;

  for (let day = 1; day <= lastDay; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = new Date(date).getDay();

    if (day === 1 || dayOfWeek === 1) {
      if (day > 1) weekNum++;
      const weekEnd = new Date(date);
      weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay()));
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      weeks.push({
        week: weekNum,
        start_date: date,
        end_date: weekEndStr > endDate ? endDate : weekEndStr,
        expenses: 0,
        income: 0,
        days: [],
      });
      weekStart = date;
    }

    const dayData = daily.find((d) => d.date === date);
    if (dayData && weeks.length > 0) {
      const currentWeek = weeks[weeks.length - 1];
      currentWeek.expenses += dayData.expenses;
      currentWeek.income += dayData.income;
      currentWeek.days.push(dayData);
    }
  }

  const totalExpenses = daily.reduce((sum, d) => sum + d.expenses, 0);
  const avgDailyExpense = lastDay > 0 ? totalExpenses / lastDay : 0;

  res.json({
    month,
    total_expenses: totalExpenses,
    avg_daily_expense: Math.round(avgDailyExpense * 100) / 100,
    weeks,
  });
});

// GET /trends/comparison?months=2024-01,2024-02,2024-03
// Compares spending across multiple months
trendsRouter.get('/comparison', (req: AuthRequest, res: Response) => {
  const monthsParam = req.query.months as string;

  if (!monthsParam) {
    res.status(400).json({ error: 'months parameter required (comma-separated YYYY-MM values)' });
    return;
  }

  const months = monthsParam.split(',').map((m) => m.trim());

  if (months.length < 2) {
    res.status(400).json({ error: 'At least 2 months required for comparison' });
    return;
  }

  if (months.length > 12) {
    res.status(400).json({ error: 'Maximum 12 months allowed for comparison' });
    return;
  }

  const invalidMonths = months.filter((m) => !/^\d{4}-\d{2}$/.test(m));
  if (invalidMonths.length > 0) {
    res.status(400).json({ error: `Invalid month format: ${invalidMonths.join(', ')}` });
    return;
  }

  const db = getDb();
  const userId = req.userId!;

  const results = months.map((month) => {
    const [year, mon] = month.split('-').map(Number);
    const startDate = `${month}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const totals = db.prepare(`
      SELECT type, SUM(amount) as total, COUNT(*) as count
      FROM transactions
      WHERE user_id = ? AND date >= ? AND date <= ?
      GROUP BY type
    `).all(userId, startDate, endDate) as { type: string; total: number; count: number }[];

    const income = totals.find((r) => r.type === 'income')?.total ?? 0;
    const expenses = totals.find((r) => r.type === 'expense')?.total ?? 0;
    const txCount = totals.reduce((sum, r) => sum + r.count, 0);

    return { month, income, expenses, net: income - expenses, transaction_count: txCount };
  });

  // Calculate month-over-month change
  const withChanges = results.map((r, i) => {
    if (i === 0) return { ...r, expense_change: null, expense_change_pct: null };
    const prev = results[i - 1];
    const change = r.expenses - prev.expenses;
    const changePct = prev.expenses > 0
      ? Math.round((change / prev.expenses) * 100 * 10) / 10
      : null;
    return { ...r, expense_change: change, expense_change_pct: changePct };
  });

  res.json({ months: withChanges });
});

// GET /trends/category-history?category_id=xxx&months=6
trendsRouter.get('/category-history', (req: AuthRequest, res: Response) => {
  const categoryId = req.query.category_id as string;
  const months = parseInt(req.query.months as string) || 6;

  if (!categoryId) {
    res.status(400).json({ error: 'category_id parameter required' });
    return;
  }

  if (months < 1 || months > 24) {
    res.status(400).json({ error: 'months must be between 1 and 24' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;

  const category = db
    .prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(categoryId, userId) as any;

  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  // Generate last N months
  const now = new Date();
  const monthList: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const history = monthList.map((month) => {
    const [year, mon] = month.split('-').map(Number);
    const startDate = `${month}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const result = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM transactions
      WHERE user_id = ? AND category_id = ? AND type = 'expense'
        AND date >= ? AND date <= ?
    `).get(userId, categoryId, startDate, endDate) as { total: number; count: number };

    const budget = db
      .prepare('SELECT amount FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?')
      .get(userId, categoryId, month) as { amount: number } | undefined;

    return {
      month,
      spent: result.total,
      count: result.count,
      budget: budget?.amount ?? null,
      over_budget: budget ? result.total > budget.amount : false,
    };
  });

  res.json({ category, history });
});