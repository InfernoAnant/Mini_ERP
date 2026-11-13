import { type AccessLevel, Module, type User, type UserAccess } from '../generated/prisma/client.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export type AuthUser = {
  id: number;
  loginId: string;
  name: string;
  email: string;
  position: string | null;
  isSystemAdmin: boolean;
  readOnly: boolean;
  isDemoLocked: boolean;
  access: Record<Module, AccessLevel>;
};

export const MODULES: Module[] = Object.values(Module);

export const signupSchema = z.object({
  loginId: z
    .string()
    .trim()
    .min(6, 'Login Id must be 6–12 characters')
    .max(12, 'Login Id must be 6–12 characters')
    .regex(/^[A-Za-z0-9_]+$/, 'Login Id may contain only letters, numbers and _'),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-z]/, 'Password needs a lowercase letter')
    .regex(/[A-Z]/, 'Password needs an uppercase letter')
    .regex(/[^A-Za-z0-9]/, 'Password needs a special character'),
  name: z.string().trim().min(1, 'Name is required').max(100),
});
export type SignupInput = z.infer<typeof signupSchema>;

export function toAuthUser(user: User & { access: UserAccess[] }): AuthUser {
  const access = Object.fromEntries(MODULES.map((m) => [m, 'NONE'])) as Record<Module, AccessLevel>;
  for (const a of user.access) access[a.module] = a.level;
  if (user.isSystemAdmin) for (const m of MODULES) access[m] = 'ADMIN';
  return {
    id: user.id,
    loginId: user.loginId,
    name: user.name,
    email: user.email,
    position: user.position,
    isSystemAdmin: user.isSystemAdmin,
    readOnly: user.readOnly,
    isDemoLocked: user.isDemoLocked,
    access,
  };
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: String(user.id), role: user.isSystemAdmin ? 'SYSTEM_ADMIN' : 'USER' }, secret(), {
    expiresIn: '7d',
  });
}

/** Returns the user id and issue time (seconds) from a valid token, or null. */
export function verifyToken(token: string): { id: number; iat: number } | null {
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === 'string' || !payload.sub || typeof payload.iat !== 'number') return null;
    const id = Number(payload.sub);
    return Number.isInteger(id) ? { id, iat: payload.iat } : null;
  } catch {
    return null;
  }
}

export async function loadAuthUser(id: number): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id }, include: { access: true } });
  return user ? toAuthUser(user) : null;
}

/**
 * The user a session token belongs to. Ids restart after a demo reset, so a token issued before the
 * account was created belongs to someone else and is rejected. Demo accounts are re-created identically
 * on every reset, so their sessions stay valid.
 */
export async function loadSessionUser(token: { id: number; iat: number }): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id: token.id }, include: { access: true } });
  if (!user) return null;
  const issuedBeforeAccount = token.iat * 1000 + 1000 < user.createdAt.getTime();
  if (issuedBeforeAccount && !user.isDemoLocked) return null;
  return toAuthUser(user);
}

export async function signup(input: SignupInput): Promise<AuthUser> {
  const [byLogin, byEmail] = await Promise.all([
    prisma.user.findUnique({ where: { loginId: input.loginId } }),
    prisma.user.findUnique({ where: { email: input.email } }),
  ]);
  if (byLogin) throw new AppError(409, 'DUPLICATE', 'That Login Id is already taken');
  if (byEmail) throw new AppError(409, 'DUPLICATE', 'An account with that email already exists');
  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { loginId: input.loginId, email: input.email, name: input.name, passwordHash },
    include: { access: true },
  });
  return toAuthUser(user);
}

export async function login(loginId: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const user = await prisma.user.findUnique({ where: { loginId }, include: { access: true } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid Login Id or Password');
  }
  const authUser = toAuthUser(user);
  return { token: signToken(authUser), user: authUser };
}

export async function demoLogin(loginId: string): Promise<{ token: string; user: AuthUser }> {
  const user = await prisma.user.findUnique({ where: { loginId }, include: { access: true } });
  if (!user || !user.isDemoLocked) {
    throw new AppError(403, 'FORBIDDEN', 'Only demo accounts can be used without a password');
  }
  const authUser = toAuthUser(user);
  return { token: signToken(authUser), user: authUser };
}
