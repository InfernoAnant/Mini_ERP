import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { type AuthUser, loadSessionUser, verifyToken } from '../services/auth.service';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.token;
  const session = typeof token === 'string' ? verifyToken(token) : null;
  const user = session === null ? null : await loadSessionUser(session);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  req.user = user;
  next();
};

/** The logged-in user; only call after requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  return req.user;
}
