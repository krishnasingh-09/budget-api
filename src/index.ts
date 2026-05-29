import express from 'express';
import cors from 'cors';
import { initDb } from './db/database';
import { userRouter } from './routes/users';
import { transactionRouter } from './routes/transactions';
import { categoryRouter } from './routes/categories';
import { summaryRouter } from './routes/summary';
import { budgetRouter } from './routes/budgets';
import { alertRouter } from './routes/alerts';
import { profileRouter } from './routes/profile';
import { importRouter } from './routes/import';
import { trendsRouter } from './routes/trends';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', userRouter);
app.use('/transactions', transactionRouter);
app.use('/categories', categoryRouter);
app.use('/summary', summaryRouter);
app.use('/budgets', budgetRouter);
app.use('/alerts', alertRouter);
app.use('/profile', profileRouter);
app.use('/import', importRouter);
app.use('/trends', trendsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initDb();
  app.listen(PORT, () => {
    console.log(`budget-api running on http://localhost:${PORT}`);
  });
}