import express from 'express';
import cors from 'cors';
import { initDb } from './db/database';
import { userRouter } from './routes/users';
import { transactionRouter } from './routes/transactions';
import { categoryRouter } from './routes/categories';
import { summaryRouter } from './routes/summary';
import { budgetRouter } from './routes/budgets';

export const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', userRouter);
app.use('/transactions', transactionRouter);
app.use('/categories', categoryRouter);
app.use('/summary', summaryRouter);
app.use('/budgets', budgetRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start server if this file is run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initDb();
  app.listen(PORT, () => {
    console.log(`budget-api running on http://localhost:${PORT}`);
  });
}
