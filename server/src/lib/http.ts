import type { Request } from 'express';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive();

/** Positive integer route param (400 VALIDATION_ERROR otherwise). */
export function idParam(req: Request, name = 'id'): number {
  return idSchema.parse(req.params[name]);
}
