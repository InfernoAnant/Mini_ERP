import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/decimal.js';
import { idParam } from '../lib/http.js';
import { listQuerySchema } from '../lib/listQuery.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { getJourney } from '../services/journey.service.js';
import * as mo from '../services/manufacturing.service.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(serialize(await mo.listMos(currentUser(req), listQuerySchema.parse(req.query))));
});
router.post('/', async (req, res) => {
  res.status(201).json(serialize(await mo.createMo(currentUser(req), mo.moInputSchema.parse(req.body))));
});
router.get('/:id/journey', async (req, res) => {
  res.json(serialize(await getJourney(currentUser(req), 'MO', idParam(req))));
});
router.get('/:id', async (req, res) => {
  res.json(serialize(await mo.getMo(currentUser(req), idParam(req))));
});
/** Returns the MO plus `procured`: references of POs/MOs auto-created for a quantity increase. */
router.patch('/:id', async (req, res) => {
  const { order, procured } = await mo.updateMo(currentUser(req), idParam(req), mo.moUpdateSchema.parse(req.body));
  res.json(serialize({ ...order, procured }));
});
router.delete('/:id', async (req, res) => {
  await mo.deleteMo(currentUser(req), idParam(req));
  res.json({ ok: true });
});
router.post('/:id/confirm', async (req, res) => {
  res.json(serialize(await mo.confirmMo(currentUser(req), idParam(req))));
});
router.post('/:id/cancel', async (req, res) => {
  res.json(serialize(await mo.cancelMo(currentUser(req), idParam(req))));
});
router.post('/:id/work-orders/:woId/complete', async (req, res) => {
  const { realMinutes } = z.object({ realMinutes: z.coerce.number().int().min(0).max(100000) }).parse(req.body);
  res.json(serialize(await mo.completeWorkOrder(currentUser(req), idParam(req), idParam(req, 'woId'), realMinutes)));
});

export default router;
