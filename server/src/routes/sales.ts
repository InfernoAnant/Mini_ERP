import { Router } from 'express';
import { serialize } from '../lib/decimal';
import { idParam } from '../lib/http';
import { listQuerySchema } from '../lib/listQuery';
import { currentUser, requireAuth } from '../middleware/auth';
import { getJourney } from '../services/journey.service';
import * as so from '../services/sales.service';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(serialize(await so.listSales(currentUser(req), listQuerySchema.parse(req.query))));
});
router.post('/', async (req, res) => {
  res.status(201).json(serialize(await so.createSales(currentUser(req), so.salesInputSchema.parse(req.body))));
});
router.get('/:id/journey', async (req, res) => {
  res.json(serialize(await getJourney(currentUser(req), 'SO', idParam(req))));
});
router.get('/:id', async (req, res) => {
  res.json(serialize(await so.getSales(currentUser(req), idParam(req))));
});
/** Returns the order plus `procured`: references auto-created for quantity increases. */
router.patch('/:id', async (req, res) => {
  const { order, procured } = await so.updateSales(currentUser(req), idParam(req), so.salesInputSchema.parse(req.body));
  res.json(serialize({ ...order, procured }));
});
router.delete('/:id', async (req, res) => {
  await so.deleteSales(currentUser(req), idParam(req));
  res.json({ ok: true });
});
router.post('/:id/confirm', async (req, res) => {
  res.json(serialize(await so.confirmSales(currentUser(req), idParam(req))));
});
router.post('/:id/cancel', async (req, res) => {
  res.json(serialize(await so.cancelSales(currentUser(req), idParam(req))));
});

export default router;
