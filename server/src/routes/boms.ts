import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/decimal';
import { idParam } from '../lib/http';
import { listQuerySchema } from '../lib/listQuery';
import { currentUser, requireAuth } from '../middleware/auth';
import * as boms from '../services/bom.service';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const q = listQuerySchema.extend({ productId: z.coerce.number().int().optional() }).parse(req.query);
  res.json(serialize(await boms.listBoms(currentUser(req), q)));
});

router.get('/options', async (req, res) => {
  const productId = z.coerce.number().int().optional().parse(req.query.productId);
  res.json(serialize(await boms.bomOptions(productId)));
});

router.post('/', async (req, res) => {
  res.status(201).json(serialize(await boms.createBom(currentUser(req), boms.bomInputSchema.parse(req.body))));
});

router.get('/:id', async (req, res) => {
  res.json(serialize(await boms.getBom(currentUser(req), idParam(req))));
});

router.patch('/:id', async (req, res) => {
  res.json(serialize(await boms.updateBom(currentUser(req), idParam(req), boms.bomInputSchema.parse(req.body))));
});

router.delete('/:id', async (req, res) => {
  await boms.deleteBom(currentUser(req), idParam(req));
  res.json({ ok: true });
});

export default router;
