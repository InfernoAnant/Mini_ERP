import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/decimal.js';
import { idParam } from '../lib/http.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import * as ops from '../services/operations.service.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(serialize(await ops.listOperations(currentUser(req), ops.operationQuerySchema.parse(req.query))));
});
router.post('/', async (req, res) => {
  res.status(201).json(serialize(await ops.placeOperation(currentUser(req), ops.placeOperationSchema.parse(req.body))));
});
router.post('/:id/confirm', async (req, res) => {
  res.json(serialize(await ops.confirmOperation(currentUser(req), idParam(req))));
});
router.post('/:id/reject', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(2, 'Give a reason').max(300) }).parse(req.body);
  res.json(serialize(await ops.rejectOperation(currentUser(req), idParam(req), reason)));
});

export default router;
