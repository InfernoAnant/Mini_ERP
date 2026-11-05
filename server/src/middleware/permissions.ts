import type { Module } from '@prisma/client';
import type { RequestHandler } from 'express';
import { type Action, assertCan } from '../config/permissions';
import { AppError } from '../lib/errors';
import { currentUser } from './auth';

export function requirePermission(module: Module, action: Action): RequestHandler {
  return (req, _res, next) => {
    assertCan(currentUser(req), module, action);
    next();
  };
}

export const requireSystemAdmin: RequestHandler = (req, _res, next) => {
  if (!currentUser(req).isSystemAdmin) throw new AppError(403, 'FORBIDDEN', 'Only the system administrator can do this');
  next();
};
