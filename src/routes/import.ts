import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const importRouter = Router();
importRouter.use(authMiddleware);

interface ParsedTransaction {
  amount: number;
  description: string;
  type: 'income' | 'expense';
  date: string;
  category_name?: string;
  notes?: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function validateTransaction(row: Record<string, string>, lineNum: number): {
  valid: boolean;
  data?: ParsedTransaction;
  error?: string;
} {
  const amount = parseFloat(row.amount);
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: `Line ${lineNum}: invalid amount "${row.amount}"` };
  }

  if (!row.description || row.description.trim().length === 0) {
    return { valid: false, error: `Line ${lineNum}: description is required` };
  }

  if (!['income', 'expense'].includes(row.type)) {
    return { valid: false, error: `Line ${lineNum}: type must be "income" or "expense"` };
  }

  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    return { valid: false, error: `Line ${lineNum}: date must be in YYYY-MM-DD format` };
  }

  return {
    valid: true,
    data: {
      amount,
      description: row.description.trim(),
      type: row.type as 'income' | 'expense',
      date: row.date,
      category_name: row.category_name?.trim() || undefined,
      notes: row.notes?.trim() || undefined,
    },
  };
}

// POST /import/csv
// Body: { csv: string }
importRouter.post('/csv', (req: AuthRequest, res: Response) => {
  const { csv } = req.body;

  if (!csv || typeof csv !== 'string') {
    res.status(400).json({ error: 'csv field is required and must be a string' });
    return;
  }

  const lines = csv.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length < 2) {
    res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
    return;
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));

  const requiredHeaders = ['amount', 'description', 'type', 'date'];
  const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    res.status(400).json({
      error: `Missing required CSV columns: ${missingHeaders.join(', ')}`,
    });
    return;
  }

  const db = getDb();
  const userId = req.userId!;

  const errors: string[] = [];
  const toInsert: ParsedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });

    const result = validateTransaction(row, i + 1);
    if (!result.valid) {
      errors.push(result.error!);
    } else {
      toInsert.push(result.data!);
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ error: 'CSV validation failed', errors });
    return;
  }

  // Resolve category names to IDs
  const categoryCache: Record<string, string> = {};

  const insertMany = db.transaction((transactions: ParsedTransaction[]) => {
    let inserted = 0;
    for (const tx of transactions) {
      let categoryId: string | null = null;

      if (tx.category_name) {
        if (categoryCache[tx.category_name]) {
          categoryId = categoryCache[tx.category_name];
        } else {
          const cat = db
            .prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?')
            .get(userId, tx.category_name) as { id: string } | undefined;

          if (cat) {
            categoryId = cat.id;
            categoryCache[tx.category_name] = cat.id;
          }
        }
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO transactions (id, user_id, category_id, amount, description, type, date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, categoryId, tx.amount, tx.description, tx.type, tx.date, tx.notes ?? null);
      inserted++;
    }
    return inserted;
  });

  const inserted = insertMany(toInsert);

  res.status(201).json({
    message: `Successfully imported ${inserted} transactions`,
    imported: inserted,
    skipped: 0,
  });
});

// GET /import/template
// Returns a CSV template for download
importRouter.get('/template', (_req: AuthRequest, res: Response) => {
  const template = [
    'amount,description,type,date,category_name,notes',
    '1000.00,Monthly salary,income,2024-03-01,Salary,',
    '50.00,Grocery shopping,expense,2024-03-02,Food,Weekly groceries',
    '200.00,Electric bill,expense,2024-03-03,Utilities,',
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="import-template.csv"');
  res.send(template);
});