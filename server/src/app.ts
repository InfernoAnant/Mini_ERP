import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import auditRoutes from './routes/audit.js';
import authRoutes from './routes/auth.js';
import bomRoutes from './routes/boms.js';
import { dashboardRouter, demoRouter } from './routes/dashboard.js';
import { contactsRouter, workCentersRouter } from './routes/contacts.js';
import manufacturingRoutes from './routes/manufacturing.js';
import operationRoutes from './routes/operations.js';
import productRoutes from './routes/products.js';
import purchaseRoutes from './routes/purchase.js';
import salesRoutes from './routes/sales.js';
import userRoutes from './routes/users.js';
// Installs MTO procurement into manufacturing confirmation (see setComponentProcurer).
import './services/procurement.service.js';

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
  app.use('/api/purchase', purchaseRoutes);
  app.use('/api/manufacturing', manufacturingRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/operations', operationRoutes);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/demo', demoRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/work-centers', workCentersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
