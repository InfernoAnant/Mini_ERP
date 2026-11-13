import { Router } from 'express';
import { z } from 'zod';
import { idParam } from '../lib/http.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import * as users from '../services/users.service.js';

const router = Router();
router.use(requireAuth);

router.get('/me', async (req, res) => {
  res.json(await users.getProfile(currentUser(req)));
});
router.patch('/me', async (req, res) => {
  res.json(await users.updateProfile(currentUser(req), users.profileSchema.parse(req.body)));
});
router.get('/options', async (req, res) => {
  res.json(await users.userOptions(currentUser(req)));
});
router.get('/', async (req, res) => {
  const q = z
    .object({
      q: z.string().trim().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    })
    .parse(req.query);
  res.json(await users.listUsers(currentUser(req), q));
});
router.get('/:id', async (req, res) => {
  res.json(await users.getUser(currentUser(req), idParam(req)));
});
router.patch('/:id', async (req, res) => {
  res.json(await users.adminUpdateUser(currentUser(req), idParam(req), users.adminUserSchema.parse(req.body)));
});
router.put('/:id/access', async (req, res) => {
  res.json(await users.setAccess(currentUser(req), idParam(req), users.accessSchema.parse(req.body)));
});

export default router;
