import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const calculatorRouter = Router();
calculatorRouter.use(authMiddleware);

// ─── Helper Math Functions ───────────────────────────────────────────────────

function roundTo(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function presentValue(futureValue: number, rate: number, periods: number): number {
  if (rate === 0) return futureValue;
  return futureValue / Math.pow(1 + rate, periods);
}

function futureValue(presentVal: number, rate: number, periods: number): number {
  return presentVal * Math.pow(1 + rate, periods);
}

function monthlyPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 12;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

function internalRateOfReturn(cashFlows: number[]): number {
  // Newton-Raphson method for IRR
  let rate = 0.1;
  const maxIterations = 1000;
  const tolerance = 1e-7;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;

    for (let t = 0; t < cashFlows.length; t++) {
      const discount = Math.pow(1 + rate, t);
      npv += cashFlows[t] / discount;
      dnpv -= t * cashFlows[t] / (discount * (1 + rate));
    }

    if (Math.abs(dnpv) < tolerance) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < tolerance) {
      rate = newRate;
      break;
    }
    rate = newRate;
  }

  return rate;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  const ssTot = y.reduce((acc, yi) => acc + Math.pow(yi - meanY, 2), 0);
  const ssRes = x.reduce((acc, xi, i) => acc + Math.pow(y[i] - (slope * xi + intercept), 2), 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

// ─── Compound Interest ────────────────────────────────────────────────────────

// POST /calculator/compound-interest
calculatorRouter.post('/compound-interest', (req: AuthRequest, res: Response) => {
  const { principal, annual_rate, years, compounds_per_year = 12, monthly_contribution = 0 } = req.body;

  if (!principal || !annual_rate || !years) {
    res.status(400).json({ error: 'principal, annual_rate, and years are required' });
    return;
  }
  if (principal <= 0 || annual_rate < 0 || years <= 0) {
    res.status(400).json({ error: 'principal and years must be positive, annual_rate must be non-negative' });
    return;
  }

  const n = compounds_per_year;
  const r = annual_rate / 100;
  const t = years;
  const pmt = monthly_contribution;

  // Compound interest: A = P(1 + r/n)^(nt)
  const principalGrowth = principal * Math.pow(1 + r / n, n * t);

  // Future value of recurring contributions
  let contributionGrowth = 0;
  if (pmt > 0 && r > 0) {
    const periodicRate = r / n;
    const totalPeriods = n * t;
    contributionGrowth = pmt * (Math.pow(1 + periodicRate, totalPeriods) - 1) / periodicRate;
  } else if (pmt > 0) {
    contributionGrowth = pmt * n * t;
  }

  const finalAmount = principalGrowth + contributionGrowth;
  const totalContributions = principal + pmt * n * t;
  const totalInterest = finalAmount - totalContributions;

  // Year by year breakdown
  const yearlyBreakdown = Array.from({ length: Math.min(t, 50) }, (_, i) => {
    const year = i + 1;
    const pGrowth = principal * Math.pow(1 + r / n, n * year);
    let cGrowth = 0;
    if (pmt > 0 && r > 0) {
      const periodicRate = r / n;
      const periods = n * year;
      cGrowth = pmt * (Math.pow(1 + periodicRate, periods) - 1) / periodicRate;
    } else if (pmt > 0) {
      cGrowth = pmt * n * year;
    }
    const total = pGrowth + cGrowth;
    const contributed = principal + pmt * n * year;
    return {
      year,
      balance: roundTo(total, 2),
      interest_earned: roundTo(total - contributed, 2),
      total_contributed: roundTo(contributed, 2),
    };
  });

  res.json({
    principal,
    annual_rate,
    years,
    compounds_per_year: n,
    monthly_contribution: pmt,
    final_amount: roundTo(finalAmount, 2),
    total_contributions: roundTo(totalContributions, 2),
    total_interest: roundTo(totalInterest, 2),
    effective_annual_rate: roundTo((Math.pow(1 + r / n, n) - 1) * 100, 4),
    yearly_breakdown: yearlyBreakdown,
  });
});

// ─── Loan Amortization ────────────────────────────────────────────────────────

// POST /calculator/loan
calculatorRouter.post('/loan', (req: AuthRequest, res: Response) => {
  const { principal, annual_rate, months, extra_payment = 0 } = req.body;

  if (!principal || annual_rate === undefined || !months) {
    res.status(400).json({ error: 'principal, annual_rate, and months are required' });
    return;
  }
  if (principal <= 0 || annual_rate < 0 || months <= 0) {
    res.status(400).json({ error: 'Invalid values: principal and months must be positive' });
    return;
  }

  const payment = monthlyPayment(principal, annual_rate / 100, months);
  const totalPayment = payment + extra_payment;

  // Build amortization schedule
  let balance = principal;
  let totalInterest = 0;
  let actualMonths = 0;
  const schedule = [];

  for (let m = 1; m <= months && balance > 0; m++) {
    const interestPayment = balance * (annual_rate / 100 / 12);
    const principalPayment = Math.min(totalPayment - interestPayment, balance);

    if (principalPayment <= 0) {
      res.status(400).json({ error: 'Payment too low to cover interest' });
      return;
    }

    balance -= principalPayment;
    totalInterest += interestPayment;
    actualMonths = m;

    if (schedule.length < 36) {
      schedule.push({
        month: m,
        payment: roundTo(Math.min(totalPayment, principalPayment + interestPayment + Math.max(balance, 0)), 2),
        principal: roundTo(principalPayment, 2),
        interest: roundTo(interestPayment, 2),
        balance: roundTo(Math.max(balance, 0), 2),
      });
    }

    if (balance <= 0.01) break;
  }

  // Calculate savings from extra payment
  const basePayment = monthlyPayment(principal, annual_rate / 100, months);
  let baseTotalInterest = 0;
  let baseBalance = principal;
  for (let m = 1; m <= months && baseBalance > 0; m++) {
    const interestPayment = baseBalance * (annual_rate / 100 / 12);
    const principalPayment = Math.min(basePayment - interestPayment, baseBalance);
    baseBalance -= principalPayment;
    baseTotalInterest += interestPayment;
    if (baseBalance <= 0.01) break;
  }

  res.json({
    principal,
    annual_rate,
    term_months: months,
    monthly_payment: roundTo(payment, 2),
    extra_payment,
    total_payment_with_extra: roundTo(totalPayment, 2),
    actual_payoff_months: actualMonths,
    months_saved: months - actualMonths,
    total_interest: roundTo(totalInterest, 2),
    interest_saved: roundTo(baseTotalInterest - totalInterest, 2),
    total_cost: roundTo(principal + totalInterest, 2),
    schedule: schedule,
  });
});

// ─── Budget Forecast ──────────────────────────────────────────────────────────

// GET /calculator/forecast?months=6
calculatorRouter.get('/forecast', (req: AuthRequest, res: Response) => {
  const forecastMonths = parseInt(req.query.months as string) || 6;
  const userId = req.userId!;

  if (forecastMonths < 1 || forecastMonths > 24) {
    res.status(400).json({ error: 'months must be between 1 and 24' });
    return;
  }

  const db = getDb();

  // Get last 6 months of data for regression
  const history = db.prepare(`
    SELECT 
      strftime('%Y-%m', date) as month,
      SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expenses,
      SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income
    FROM transactions
    WHERE user_id = ?
    GROUP BY month
    ORDER BY month ASC
    LIMIT 12
  `).all(userId) as { month: string; expenses: number; income: number }[];

  if (history.length < 2) {
    res.status(400).json({ error: 'Need at least 2 months of transaction history for forecasting' });
    return;
  }

  // Use linear regression on historical data
  const x = history.map((_, i) => i);
  const expenseY = history.map((h) => h.expenses);
  const incomeY = history.map((h) => h.income);

  const expenseRegression = linearRegression(x, expenseY);
  const incomeRegression = linearRegression(x, incomeY);

  // Generate forecast
  const lastMonth = history[history.length - 1].month;
  const [lastYear, lastMon] = lastMonth.split('-').map(Number);

  const forecast = Array.from({ length: forecastMonths }, (_, i) => {
    const monthOffset = i + 1;
    const forecastDate = new Date(lastYear, lastMon - 1 + monthOffset, 1);
    const monthStr = `${forecastDate.getFullYear()}-${String(forecastDate.getMonth() + 1).padStart(2, '0')}`;

    const xVal = history.length + i;
    const projectedExpenses = Math.max(0, expenseRegression.slope * xVal + expenseRegression.intercept);
    const projectedIncome = Math.max(0, incomeRegression.slope * xVal + incomeRegression.intercept);

    return {
      month: monthStr,
      projected_expenses: roundTo(projectedExpenses, 2),
      projected_income: roundTo(projectedIncome, 2),
      projected_net: roundTo(projectedIncome - projectedExpenses, 2),
    };
  });

  // Calculate historical stats
  const avgExpenses = expenseY.reduce((a, b) => a + b, 0) / expenseY.length;
  const avgIncome = incomeY.reduce((a, b) => a + b, 0) / incomeY.length;
  const expenseStdDev = standardDeviation(expenseY);

  res.json({
    historical_months: history.length,
    avg_monthly_expenses: roundTo(avgExpenses, 2),
    avg_monthly_income: roundTo(avgIncome, 2),
    expense_trend: expenseRegression.slope > 0 ? 'increasing' : expenseRegression.slope < 0 ? 'decreasing' : 'stable',
    income_trend: incomeRegression.slope > 0 ? 'increasing' : incomeRegression.slope < 0 ? 'decreasing' : 'stable',
    expense_volatility: roundTo(expenseStdDev, 2),
    expense_regression_r2: roundTo(expenseRegression.r2, 4),
    forecast,
  });
});

// ─── Net Worth Tracker ────────────────────────────────────────────────────────

// POST /calculator/net-worth
calculatorRouter.post('/net-worth', (req: AuthRequest, res: Response) => {
  const { assets, liabilities } = req.body;

  if (!Array.isArray(assets) || !Array.isArray(liabilities)) {
    res.status(400).json({ error: 'assets and liabilities must be arrays' });
    return;
  }

  interface Asset {
    name: string;
    value: number;
    annual_growth_rate?: number;
  }

  interface Liability {
    name: string;
    balance: number;
    annual_rate?: number;
    monthly_payment?: number;
  }

  const validatedAssets: Asset[] = [];
  for (const asset of assets) {
    if (!asset.name || typeof asset.value !== 'number' || asset.value < 0) {
      res.status(400).json({ error: `Invalid asset: ${JSON.stringify(asset)}` });
      return;
    }
    validatedAssets.push({
      name: asset.name,
      value: asset.value,
      annual_growth_rate: asset.annual_growth_rate ?? 0,
    });
  }

  const validatedLiabilities: Liability[] = [];
  for (const liability of liabilities) {
    if (!liability.name || typeof liability.balance !== 'number' || liability.balance < 0) {
      res.status(400).json({ error: `Invalid liability: ${JSON.stringify(liability)}` });
      return;
    }
    validatedLiabilities.push({
      name: liability.name,
      balance: liability.balance,
      annual_rate: liability.annual_rate ?? 0,
      monthly_payment: liability.monthly_payment ?? 0,
    });
  }

  const totalAssets = validatedAssets.reduce((sum, a) => sum + a.value, 0);
  const totalLiabilities = validatedLiabilities.reduce((sum, l) => sum + l.balance, 0);
  const netWorth = totalAssets - totalLiabilities;

  // Project net worth over 5 years
  const projection = Array.from({ length: 5 }, (_, yearIdx) => {
    const year = yearIdx + 1;

    const projectedAssets = validatedAssets.reduce((sum, a) => {
      return sum + futureValue(a.value, (a.annual_growth_rate ?? 0) / 100, year);
    }, 0);

    const projectedLiabilities = validatedLiabilities.reduce((sum, l) => {
      if (l.monthly_payment && l.monthly_payment > 0 && l.balance > 0) {
        const monthlyRate = (l.annual_rate ?? 0) / 100 / 12;
        let balance = l.balance;
        for (let m = 0; m < year * 12 && balance > 0; m++) {
          const interest = balance * monthlyRate;
          const principal = Math.min(l.monthly_payment - interest, balance);
          if (principal <= 0) break;
          balance -= principal;
        }
        return sum + Math.max(0, balance);
      }
      return sum + futureValue(l.balance, (l.annual_rate ?? 0) / 100, year);
    }, 0);

    return {
      year,
      projected_assets: roundTo(projectedAssets, 2),
      projected_liabilities: roundTo(projectedLiabilities, 2),
      projected_net_worth: roundTo(projectedAssets - projectedLiabilities, 2),
    };
  });

  // Debt-to-asset ratio
  const debtToAssetRatio = totalAssets > 0 ? totalLiabilities / totalAssets : null;

  res.json({
    total_assets: roundTo(totalAssets, 2),
    total_liabilities: roundTo(totalLiabilities, 2),
    net_worth: roundTo(netWorth, 2),
    debt_to_asset_ratio: debtToAssetRatio !== null ? roundTo(debtToAssetRatio, 4) : null,
    solvency: netWorth >= 0 ? 'solvent' : 'insolvent',
    assets: validatedAssets,
    liabilities: validatedLiabilities,
    five_year_projection: projection,
  });
});

// ─── Retirement Calculator ────────────────────────────────────────────────────

// POST /calculator/retirement
calculatorRouter.post('/retirement', (req: AuthRequest, res: Response) => {
  const {
    current_age,
    retirement_age,
    current_savings,
    monthly_contribution,
    expected_annual_return,
    expected_inflation,
    desired_monthly_income,
    years_in_retirement = 25,
  } = req.body;

  if (!current_age || !retirement_age || current_savings === undefined ||
      !monthly_contribution || !expected_annual_return || !desired_monthly_income) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  if (current_age >= retirement_age) {
    res.status(400).json({ error: 'retirement_age must be greater than current_age' });
    return;
  }

  if (current_age < 0 || retirement_age > 100 || years_in_retirement < 1) {
    res.status(400).json({ error: 'Invalid age values' });
    return;
  }

  const yearsToRetirement = retirement_age - current_age;
  const realReturn = (expected_annual_return - expected_inflation) / 100;
  const nominalReturn = expected_annual_return / 100;

  // Future value of current savings
  const savingsGrowth = futureValue(current_savings, nominalReturn, yearsToRetirement);

  // Future value of monthly contributions
  const monthlyRate = nominalReturn / 12;
  const totalMonths = yearsToRetirement * 12;
  let contributionGrowth = 0;
  if (monthlyRate > 0) {
    contributionGrowth = monthly_contribution *
      (Math.pow(1 + monthlyRate, totalMonths) - 1) / monthlyRate;
  } else {
    contributionGrowth = monthly_contribution * totalMonths;
  }

  const totalAtRetirement = savingsGrowth + contributionGrowth;

  // How much needed for retirement
  // Adjust desired income for inflation
  const inflationAdjustedIncome = desired_monthly_income *
    Math.pow(1 + expected_inflation / 100, yearsToRetirement);

  // Present value of annuity for retirement years
  const retirementMonthlyRate = realReturn / 12;
  const retirementMonths = years_in_retirement * 12;
  let neededAtRetirement: number;

  if (retirementMonthlyRate > 0) {
    neededAtRetirement = inflationAdjustedIncome *
      (1 - Math.pow(1 + retirementMonthlyRate, -retirementMonths)) / retirementMonthlyRate;
  } else {
    neededAtRetirement = inflationAdjustedIncome * retirementMonths;
  }

  const surplusDeficit = totalAtRetirement - neededAtRetirement;
  const onTrack = surplusDeficit >= 0;

  // Monthly contribution needed to meet goal
  let requiredMonthlyContribution = 0;
  const gap = neededAtRetirement - savingsGrowth;
  if (gap > 0 && monthlyRate > 0) {
    requiredMonthlyContribution = gap * monthlyRate /
      (Math.pow(1 + monthlyRate, totalMonths) - 1);
  } else if (gap > 0) {
    requiredMonthlyContribution = gap / totalMonths;
  }

  // Savings rate assessment
  const savingsRateScore = clamp(
    Math.round((totalAtRetirement / neededAtRetirement) * 100),
    0,
    200
  );

  res.json({
    years_to_retirement: yearsToRetirement,
    projected_savings_at_retirement: roundTo(totalAtRetirement, 2),
    needed_at_retirement: roundTo(neededAtRetirement, 2),
    surplus_deficit: roundTo(surplusDeficit, 2),
    on_track: onTrack,
    readiness_score: savingsRateScore,
    inflation_adjusted_monthly_income: roundTo(inflationAdjustedIncome, 2),
    required_monthly_contribution: roundTo(requiredMonthlyContribution, 2),
    current_monthly_contribution: monthly_contribution,
    contribution_gap: roundTo(Math.max(0, requiredMonthlyContribution - monthly_contribution), 2),
    breakdown: {
      savings_growth: roundTo(savingsGrowth, 2),
      contribution_growth: roundTo(contributionGrowth, 2),
      total_contributed: roundTo(current_savings + monthly_contribution * totalMonths, 2),
      total_growth: roundTo(totalAtRetirement - current_savings - monthly_contribution * totalMonths, 2),
    },
  });
});

// ─── Spending Analysis ────────────────────────────────────────────────────────

// GET /calculator/spending-analysis
calculatorRouter.get('/spending-analysis', (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const db = getDb();

  const monthlyData = db.prepare(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expenses,
      SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
      COUNT(CASE WHEN type = 'expense' THEN 1 END) as expense_count
    FROM transactions
    WHERE user_id = ?
    GROUP BY month
    ORDER BY month ASC
  `).all(userId) as { month: string; expenses: number; income: number; expense_count: number }[];

  if (monthlyData.length === 0) {
    res.status(400).json({ error: 'No transaction data available for analysis' });
    return;
  }

  const expenses = monthlyData.map((m) => m.expenses);
  const incomes = monthlyData.map((m) => m.income);
  const savingsRates = monthlyData.map((m) =>
    m.income > 0 ? ((m.income - m.expenses) / m.income) * 100 : 0
  );

  const avgExpenses = expenses.reduce((a, b) => a + b, 0) / expenses.length;
  const avgIncome = incomes.reduce((a, b) => a + b, 0) / incomes.length;
  const avgSavingsRate = savingsRates.reduce((a, b) => a + b, 0) / savingsRates.length;

  const expenseStdDev = standardDeviation(expenses);
  const incomeStdDev = standardDeviation(incomes);

  // Coefficient of variation (consistency score)
  const expenseConsistency = avgExpenses > 0 ? 1 - clamp(expenseStdDev / avgExpenses, 0, 1) : 0;

  // Best and worst months
  const bestSavingsMonth = monthlyData.reduce((best, m) =>
    (m.income - m.expenses) > (best.income - best.expenses) ? m : best
  );
  const worstSavingsMonth = monthlyData.reduce((worst, m) =>
    (m.income - m.expenses) < (worst.income - worst.expenses) ? m : worst
  );

  // Top spending categories overall
  const topCategories = db.prepare(`
    SELECT
      COALESCE(c.name, 'Uncategorized') as category,
      SUM(t.amount) as total,
      COUNT(*) as count,
      AVG(t.amount) as avg_amount
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ? AND t.type = 'expense'
    GROUP BY t.category_id
    ORDER BY total DESC
    LIMIT 10
  `).all(userId) as any[];

  // Financial health score (0-100)
  const savingsScore = clamp(avgSavingsRate * 2, 0, 40); // 40 points for savings rate
  const consistencyScore = expenseConsistency * 30; // 30 points for consistency
  const diversityScore = clamp(topCategories.length * 3, 0, 30); // 30 points for category diversity
  const healthScore = Math.round(savingsScore + consistencyScore + diversityScore);

  res.json({
    analysis_period_months: monthlyData.length,
    financial_health_score: healthScore,
    health_rating: healthScore >= 80 ? 'excellent' : healthScore >= 60 ? 'good' : healthScore >= 40 ? 'fair' : 'poor',
    averages: {
      monthly_expenses: roundTo(avgExpenses, 2),
      monthly_income: roundTo(avgIncome, 2),
      monthly_savings: roundTo(avgIncome - avgExpenses, 2),
      savings_rate: roundTo(avgSavingsRate, 2),
    },
    volatility: {
      expense_std_dev: roundTo(expenseStdDev, 2),
      income_std_dev: roundTo(incomeStdDev, 2),
      expense_consistency_score: roundTo(expenseConsistency * 100, 1),
    },
    highlights: {
      best_savings_month: bestSavingsMonth.month,
      worst_savings_month: worstSavingsMonth.month,
      highest_expense_month: monthlyData.reduce((m, c) => c.expenses > m.expenses ? c : m).month,
      lowest_expense_month: monthlyData.reduce((m, c) => c.expenses < m.expenses ? c : m).month,
    },
    top_spending_categories: topCategories.map((c) => ({
      ...c,
      total: roundTo(c.total, 2),
      avg_amount: roundTo(c.avg_amount, 2),
    })),
    monthly_data: monthlyData,
  });
});