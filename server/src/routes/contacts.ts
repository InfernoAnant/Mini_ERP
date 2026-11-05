import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../middleware/auth';
import { contactSchema, createContact, listContacts, listWorkCenters } from '../services/contacts.service';

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get('/', async (req, res) => {
  const type = z.enum(['CUSTOMER', 'VENDOR']).optional().parse(req.query.type);
  res.json(await listContacts(type));
});

contactsRouter.post('/', async (req, res) => {
  res.status(201).json(await createContact(currentUser(req), contactSchema.parse(req.body)));
});

export const workCentersRouter = Router();
workCentersRouter.use(requireAuth);
workCentersRouter.get('/', async (_req, res) => {
  res.json(await listWorkCenters());
});
