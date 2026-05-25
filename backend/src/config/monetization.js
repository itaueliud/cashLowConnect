const EARNING_MODULES = [
  { key: 'remote_jobs', label: 'Remote Jobs', href: '/dashboard/jobs' },
  { key: 'paid_surveys', label: 'Paid Surveys', href: '/dashboard/surveys' },
  { key: 'microtasks', label: 'Microtasks', href: '/dashboard/tasks' },
  { key: 'ads_network', label: 'Ads / Ad Network', href: '/dashboard/ads-network' },
  { key: 'offerwalls', label: 'Offerwalls', href: '/dashboard/offerwalls' },
  { key: 'cash_tasks', label: 'Cash Tasks', href: '/dashboard/cash-tasks' },
  { key: 'referral_earnings', label: 'Referral Earnings', href: '/dashboard/referrals' },
  { key: 'daily_challenges', label: 'Daily Challenges', href: '/dashboard#daily-challenges' },
];

const TOKEN_PACKAGES = [
  { tokens: 10, amountKES: 100 },
  { tokens: 25, amountKES: 220 },
  { tokens: 50, amountKES: 400 },
  { tokens: 100, amountKES: 750 },
  { tokens: 250, amountKES: 1700 },
  { tokens: 500, amountKES: 3000 },
];

const JOB_POSTING_TOKEN_COST = 10;

const JOB_APPLICATION_TOKEN_TIERS = [
  { min: 0, max: 25, tokens: 1 },
  { min: 26, max: 50, tokens: 2 },
  { min: 51, max: 150, tokens: 3 },
  { min: 151, max: 300, tokens: 4 },
  { min: 301, max: 700, tokens: 5 },
  { min: 701, max: 1500, tokens: 8 },
  { min: 1501, max: Number.POSITIVE_INFINITY, tokens: 12 },
];

const CASH_TASK_PAYOUT_TIERS = [
  { min: 151, max: 700, amountKES: 500 },
  { min: 701, max: Number.POSITIVE_INFINITY, amountKES: 1000 },
];

const getApplicationTokenCost = (budgetAmount = 0) => {
  const numericBudget = Number(budgetAmount) || 0;
  const tier = JOB_APPLICATION_TOKEN_TIERS.find((entry) => numericBudget >= entry.min && numericBudget <= entry.max);
  return tier?.tokens || JOB_APPLICATION_TOKEN_TIERS[0].tokens;
};

const getTokenPackage = (tokenCount) => TOKEN_PACKAGES.find((entry) => entry.tokens === Number(tokenCount)) || null;

module.exports = {
  EARNING_MODULES,
  TOKEN_PACKAGES,
  JOB_POSTING_TOKEN_COST,
  JOB_APPLICATION_TOKEN_TIERS,
  CASH_TASK_PAYOUT_TIERS,
  getApplicationTokenCost,
  getTokenPackage,
};
