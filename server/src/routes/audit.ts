import { Router } from 'express';
import { serialize } from '../lib/decimal';
import { requireAuth } from '../middleware/auth';
import { requireSystemAdmin } from '../middleware/permissions';
import { auditQuerySchema, listAudit } from '../services/audit.service';

const router = Router();

router.get('/', requireAuth, requireSystemAdmin, async (req, res) => {
  res.json(serialize(await listAudit(auditQuerySchema.parse(req.query))));
});

export default router;
