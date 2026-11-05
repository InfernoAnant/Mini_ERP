import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });
process.env.JWT_SECRET ??= 'test-secret';
