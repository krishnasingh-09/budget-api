import { app } from '../src';
import { initDb, closeDb, getDb } from '../src/db/database';
import supertest from 'supertest';
import path from 'path';
import fs from 'fs';

// Use a temp DB for tests
const TEST_DB = path.join(__dirname, 'test.db');
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret';

export const request = supertest(app);

export function setupTestDb() {
  beforeAll(() => {
    initDb();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  afterEach(() => {
    // Clean all data between tests
    const db = getDb();
    db.exec('DELETE FROM transactions; DELETE FROM budgets; DELETE FROM categories; DELETE FROM users;');
  });
}

export async function createUserAndLogin(
  email = 'test@example.com',
  password = 'password123',
  name = 'Test User'
): Promise<{ token: string; userId: string }> {
  const res = await request.post('/auth/register').send({ email, password, name });
  return { token: res.body.token, userId: res.body.user.id };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
