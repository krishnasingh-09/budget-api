import { Router, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const auditRouter = Router();
auditRouter.use(authMiddleware);

export type AuditAction =
  | 'create_transaction'
  | 'update_transaction'
  | 'delete_transaction'
  | 'create_category'
  | 'update_category'
  | 'delete_category'
  | 'create_budget'
  | 'update_budget'
  | 'delete_budget'
  | 'create_savings_goal'
  | 'update_savings_goal'
  | 'delete_savings_goal'
  | 'contribute_savings'
  | 'update_profile'
  | 'change_password'
  | 'import_transactions';

export type AuditResource = 'transaction' | 'category' | 'budget' | 'savings_goal' | 'profile';

function initAuditTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

export function logAudit(
  userId: string,
  action: AuditAction,
  resource: AuditResource,
  resourceId?: string,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string
): void {
  try {
    initAuditTable();
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, resource, resource_id, old_value, new_value, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      action,
      resource,
      resourceId ?? null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ipAddress ?? null
    );
  } catch {
    // Audit logging should never break the main flow
    console.error('Failed to write audit log');
  }
}

// GET /audit
auditRouter.get('/', (req: AuthRequest, res: Response) => {
  initAuditTable();
  const db = getDb();
  const userId = req.userId!;

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
  const resource = req.query.resource as string | undefined;
  const action = req.query.action as string | undefined;
  const startDate = req.query.start_date as string | undefined;
  const endDate = req.query.end_date as string | undefined;

  let query = 'SELECT * FROM audit_logs WHERE user_id = ?';
  const params: any[] = [userId];

  if (resource) {
    query += ' AND resource = ?';
    params.push(resource);
  }
  if (action) {
    query += ' AND action = ?';
    params.push(action);
  }
  if (startDate) {
    query += ' AND date(created_at) >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND date(created_at) <= ?';
    params.push(endDate);
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
  const total = (db.prepare(countQuery).get(...params) as { count: number }).count;

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.prepare(query).all(...params) as any[];

  const parsed = logs.map((log) => ({
    ...log,
    old_value: log.old_value ? JSON.parse(log.old_value) : null,
    new_value: log.new_value ? JSON.parse(log.new_value) : null,
  }));

  res.json({
    data: parsed,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// GET /audit/summary
auditRouter.get('/summary', (req: AuthRequest, res: Response) => {
  initAuditTable();
  const db = getDb();
  const userId = req.userId!;

  const byAction = db.prepare(`
    SELECT action, COUNT(*) as count
    FROM audit_logs
    WHERE user_id = ?
    GROUP BY action
    ORDER BY count DESC
  `).all(userId) as { action: string; count: number }[];

  const byResource = db.prepare(`
    SELECT resource, COUNT(*) as count
    FROM audit_logs
    WHERE user_id = ?
    GROUP BY resource
    ORDER BY count DESC
  `).all(userId) as { resource: string; count: number }[];

  const recentActivity = db.prepare(`
    SELECT action, resource, resource_id, created_at
    FROM audit_logs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userId);

  const totalActions = db.prepare(`
    SELECT COUNT(*) as count FROM audit_logs WHERE user_id = ?
  `).get(userId) as { count: number };

  res.json({
    total_actions: totalActions.count,
    by_action: byAction,
    by_resource: byResource,
    recent_activity: recentActivity,
  });
});

// GET /audit/:id
auditRouter.get('/:id', (req: AuthRequest, res: Response) => {
  initAuditTable();
  const db = getDb();
  const log = db
    .prepare('SELECT * FROM audit_logs WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as any;

  if (!log) {
    res.status(404).json({ error: 'Audit log entry not found' });
    return;
  }

  res.json({
    ...log,
    old_value: log.old_value ? JSON.parse(log.old_value) : null,
    new_value: log.new_value ? JSON.parse(log.new_value) : null,
  });
});

// DELETE /audit — clear all audit logs for user
auditRouter.delete('/', (req: AuthRequest, res: Response) => {
  initAuditTable();
  const db = getDb();
  const result = db
    .prepare('DELETE FROM audit_logs WHERE user_id = ?')
    .run(req.userId!);
  res.json({ deleted: result.changes });
});