import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { type AuthUser, loadAuthUser, verifyToken } from '../services/auth.service';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.token;
  const id = typeof token === 'string' ? verifyToken(token) : null;
  const user = id === null ? null : await loadAuthUser(id);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  req.user = user;
  next();
};

/** The logged-in user; only call after requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  return req.user;
}
