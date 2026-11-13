import { Router } from 'express';
import { serialize } from '../lib/decimal';
import { idParam } from '../lib/http';
import { listQuerySchema } from '../lib/listQuery';
import { currentUser, requireAuth } from '../middleware/auth';
import { getJourney } from '../services/journey.service';
import * as po from '../services/purchase.service';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(serialize(await po.listPurchases(currentUser(req), listQuerySchema.parse(req.query))));
});
router.post('/', async (req, res) => {
  res.status(201).json(serialize(await po.createPurchase(currentUser(req), po.purchaseInputSchema.parse(req.body))));
});
router.get('/:id/journey', async (req, res) => {
  res.json(serialize(await getJourney(currentUser(req), 'PO', idParam(req))));
});
router.get('/:id', async (req, res) => {
  res.json(serialize(await po.getPurchase(currentUser(req), idParam(req))));
});
router.patch('/:id', async (req, res) => {
  res.json(serialize(await po.updatePurchase(currentUser(req), idParam(req), po.purchaseInputSchema.parse(req.body))));
});
router.delete('/:id', async (req, res) => {
  await po.deletePurchase(currentUser(req), idParam(req));
  res.json({ ok: true });
});
router.post('/:id/confirm', async (req, res) => {
  res.json(serialize(await po.confirmPurchase(currentUser(req), idParam(req))));
});
router.post('/:id/cancel', async (req, res) => {
  res.json(serialize(await po.cancelPurchase(currentUser(req), idParam(req))));
});

export default router;
