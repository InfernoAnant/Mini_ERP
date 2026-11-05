import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 5000);
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');

createApp().listen(port, () => {
  console.log(`Mini ERP API listening on http://localhost:${port}`);
});
