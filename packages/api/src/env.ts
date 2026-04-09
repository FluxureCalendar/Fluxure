/**
 * Preload module — must be imported BEFORE any other app module.
 * Populates process.env from .env so that config.ts reads correct values
 * at module load time (ES module imports are hoisted above inline code).
 */
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
