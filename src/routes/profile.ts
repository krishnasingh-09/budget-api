import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const profileRouter = Router();
profileRouter.use(authMiddleware);

const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

const ChangePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(8),
});

// GET /profile
profileRouter.get('/', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const user = db
    .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
    .get(req.userId!) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Get summary stats for the user
  const txCount = db
    .prepare('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?')
    .get(req.userId!) as { count: number };

  const categoryCount = db
    .prepare('SELECT COUNT(*) as count FROM categories WHERE user_id = ?')
    .get(req.userId!) as { count: number };

  const budgetCount = db
    .prepare('SELECT COUNT(*) as count FROM budgets WHERE user_id = ?')
    .get(req.userId!) as { count: number };

  const totalSpent = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE user_id = ? AND type = 'expense'
  `).get(req.userId!) as { total: number };

  const totalIncome = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE user_id = ? AND type = 'income'
  `).get(req.userId!) as { total: number };

  res.json({
    ...user,
    stats: {
      transaction_count: txCount.count,
      category_count: categoryCount.count,
      budget_count: budgetCount.count,
      total_spent: totalSpent.total,
      total_income: totalIncome.total,
      net_worth: totalIncome.total - totalSpent.total,
    },
  });
});

// PUT /profile
profileRouter.put('/', (req: AuthRequest, res: Response) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const db = getDb();

  if (updates.email) {
    const existing = db
      .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(updates.email, req.userId!);
    if (existing) {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
  }

  const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(updates);

  db.prepare(`UPDATE users SET ${fields} WHERE id = ?`).run(...values, req.userId!);

  const updated = db
    .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
    .get(req.userId!) as any;

  res.json(updated);
});

// PUT /profile/password
profileRouter.put('/password', async (req: AuthRequest, res: Response) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const { current_password, new_password } = parsed.data;
  const db = getDb();

  const user = db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(req.userId!) as { password_hash: string } | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  if (current_password === new_password) {
    res.status(400).json({ error: 'New password must be different from current password' });
    return;
  }

  const newHash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.userId!);

  res.json({ message: 'Password updated successfully' });
});

// DELETE /profile
profileRouter.delete('/', async (req: AuthRequest, res: Response) => {
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ error: 'Password required to delete account' });
    return;
  }

  const db = getDb();
  const user = db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(req.userId!) as { password_hash: string } | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.userId!);
  res.json({ message: 'Account deleted successfully' });
});