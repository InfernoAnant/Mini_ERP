import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/decimal';
import { idParam } from '../lib/http';
import { listQuerySchema } from '../lib/listQuery';
import { currentUser, requireAuth } from '../middleware/auth';
import * as products from '../services/products.service';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const q = listQuerySchema.extend({ procurementType: z.enum(['PURCHASE', 'MANUFACTURING']).optional() }).parse(req.query);
  res.json(serialize(await products.listProducts(currentUser(req), q)));
});

router.get('/options', async (req, res) => {
  res.json(serialize(await products.productOptions(currentUser(req))));
});

router.post('/', async (req, res) => {
  const input = products.createProductSchema.parse(req.body);
  res.status(201).json(serialize(await products.createProduct(currentUser(req), input)));
});

router.get('/:id', async (req, res) => {
  res.json(serialize(await products.viewProduct(currentUser(req), idParam(req))));
});

router.patch('/:id', async (req, res) => {
  const input = products.updateProductSchema.parse(req.body);
  res.json(serialize(await products.updateProduct(currentUser(req), idParam(req), input)));
});

router.get('/:id/ledger', async (req, res) => {
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  res.json(serialize(await products.getLedger(currentUser(req), idParam(req), page)));
});

export default router;
