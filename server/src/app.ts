import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './lib/errors';
import auditRoutes from './routes/audit';
import authRoutes from './routes/auth';
import bomRoutes from './routes/boms';
import { contactsRouter, workCentersRouter } from './routes/contacts';
import productRoutes from './routes/products';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/boms', bomRoutes);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/work-centers', workCentersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
