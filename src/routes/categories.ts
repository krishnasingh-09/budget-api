import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const categoryRouter = Router();
categoryRouter.use(authMiddleware);

const CategorySchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  budget_limit: z.number().positive().optional(),
});

categoryRouter.get('/', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const categories = db
    .prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC')
    .all(req.userId!);
  res.json(categories);
});

categoryRouter.get('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const category = db
    .prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }
  res.json(category);
});

categoryRouter.post('/', (req: AuthRequest, res: Response) => {
  const parsed = CategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const { name, color, budget_limit } = parsed.data;
  const db = getDb();

  const existing = db
    .prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?')
    .get(req.userId!, name);
  if (existing) {
    res.status(409).json({ error: 'Category name already exists' });
    return;
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO categories (id, user_id, name, color, budget_limit) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.userId!, name, color ?? '#6366f1', budget_limit ?? null);

  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.status(201).json(category);
});

categoryRouter.put('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const parsed = CategorySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const updates = parsed.data;
  const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(updates);

  if (fields.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  db.prepare(`UPDATE categories SET ${fields} WHERE id = ? AND user_id = ?`)
    .run(...values, req.params.id, req.userId!);

  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json(updated);
});

categoryRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.userId!
  );
  res.status(204).send();
});
