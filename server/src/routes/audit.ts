import { Router } from 'express';
import { serialize } from '../lib/decimal.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSystemAdmin } from '../middleware/permissions.js';
import { auditQuerySchema, listAudit } from '../services/audit.service.js';

const router = Router();

router.get('/', requireAuth, requireSystemAdmin, async (req, res) => {
  res.json(serialize(await listAudit(auditQuerySchema.parse(req.query))));
});

export default router;
