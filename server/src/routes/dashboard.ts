import { Router } from 'express';
import { serialize } from '../lib/decimal.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { getDashboard } from '../services/dashboard.service.js';
import { resetDemo } from '../services/demo.service.js';

export const dashboardRouter = Router();
dashboardRouter.get('/', requireAuth, async (req, res) => {
  res.json(serialize(await getDashboard(currentUser(req))));
});

/** Public: anyone can restore the shared demo data. */
export const demoRouter = Router();
demoRouter.post('/reset', async (_req, res) => {
  await resetDemo();
  res.json({ ok: true });
});
