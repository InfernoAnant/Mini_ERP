import type { ContactType } from '@prisma/client';
import { z } from 'zod';
import { assertAnyModuleAccess } from '../config/permissions';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import type { AuthUser } from './auth.service';

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  address: z.string().trim().max(300).optional(),
  type: z.enum(['CUSTOMER', 'VENDOR']),
});

export function listContacts(user: AuthUser, type?: ContactType) {
  assertAnyModuleAccess(user);
  return prisma.contact.findMany({ where: { type }, orderBy: { name: 'asc' } });
}

export function listWorkCenters(user: AuthUser) {
  assertAnyModuleAccess(user);
  return prisma.workCenter.findMany({ orderBy: { name: 'asc' } });
}

/** Anyone who can create something (not read-only, has some module access) may add a contact. */
export async function createContact(user: AuthUser, input: z.infer<typeof contactSchema>) {
  const hasAccess = user.isSystemAdmin || Object.values(user.access).some((l) => l !== 'NONE');
  if (user.readOnly || !hasAccess) throw new AppError(403, 'FORBIDDEN', "You don't have permission to add contacts");
  return prisma.contact.create({ data: { name: input.name, address: input.address ?? null, type: input.type } });
}
