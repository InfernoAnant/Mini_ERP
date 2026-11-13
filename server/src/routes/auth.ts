import { type CookieOptions, type Response, Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../middleware/auth';
import * as auth from '../services/auth.service';

const router = Router();

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // COOKIE_SECURE=false lets the Docker demo run over plain http://localhost.
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
    path: '/',
  };
}

function setToken(res: Response, token: string): void {
  res.cookie('token', token, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
}

router.post('/signup', async (req, res) => {
  const input = auth.signupSchema.parse(req.body);
  const user = await auth.signup(input);
  setToken(res, auth.signToken(user));
  res.status(201).json({ user });
});

router.post('/login', async (req, res) => {
  const { loginId, password } = z.object({ loginId: z.string().trim(), password: z.string() }).parse(req.body);
  const { token, user } = await auth.login(loginId, password);
  setToken(res, token);
  res.json({ user });
});

router.post('/demo-login', async (req, res) => {
  const { loginId } = z.object({ loginId: z.string().trim() }).parse(req.body);
  const { token, user } = await auth.demoLogin(loginId);
  setToken(res, token);
  res.json({ user });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('token', cookieOptions());
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});

export default router;
