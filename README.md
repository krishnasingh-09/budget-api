# budget-api

A personal budget management REST API built with Node.js, TypeScript, Express, and SQLite.

## Features

- User authentication (register, login, JWT tokens)
- Transaction management (income & expenses) with pagination, filtering, date ranges
- Category management with budget limits
- Monthly and date-range spending summaries
- Budget tracking with over-budget detection

## Tech Stack

- **Runtime**: Node.js 20
- **Language**: TypeScript
- **Framework**: Express 4
- **Database**: SQLite via better-sqlite3
- **Validation**: Zod
- **Auth**: JWT (jsonwebtoken) + bcrypt
- **Testing**: Jest + Supertest

## Getting Started

```bash
npm install
npm run dev       # development server (port 3000)
npm test          # run test suite
npm run build     # compile TypeScript
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/register | Register new user |
| POST | /auth/login | Login, get JWT |

### Transactions
| Method | Path | Description |
|--------|------|-------------|
| GET | /transactions | List with pagination & filters |
| POST | /transactions | Create transaction |
| GET | /transactions/:id | Get single |
| PUT | /transactions/:id | Update |
| DELETE | /transactions/:id | Delete |

Query params for GET /transactions:
- `page` (default: 1)
- `limit` (default: 20, max: 100)
- `type` (income | expense)
- `category_id`
- `start_date` (YYYY-MM-DD)
- `end_date` (YYYY-MM-DD)

### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET | /categories | List all |
| POST | /categories | Create |
| GET | /categories/:id | Get single |
| PUT | /categories/:id | Update |
| DELETE | /categories/:id | Delete |

### Budgets
| Method | Path | Description |
|--------|------|-------------|
| GET | /budgets | List (optional ?month=YYYY-MM) |
| POST | /budgets | Create |
| PUT | /budgets/:id | Update amount |
| DELETE | /budgets/:id | Delete |

### Summary
| Method | Path | Description |
|--------|------|-------------|
| GET | /summary/monthly | Monthly income/expense summary |
| GET | /summary/range | Summary over a date range |
| GET | /summary/top-categories | Top spending categories |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| DB_PATH | budget.db | SQLite database path |
| JWT_SECRET | dev-secret-key | JWT signing secret |

## Project Structure

```
src/
├── index.ts              # App entry point
├── db/
│   └── database.ts       # SQLite setup and schema
├── middleware/
│   └── auth.ts           # JWT middleware
└── routes/
    ├── users.ts          # Auth routes
    ├── transactions.ts   # Transaction CRUD
    ├── categories.ts     # Category CRUD
    ├── budgets.ts        # Budget CRUD
    └── summary.ts        # Analytics endpoints
tests/
├── helpers.ts            # Test utilities
├── auth.test.ts
├── transactions.test.ts
└── summary.test.ts
```
