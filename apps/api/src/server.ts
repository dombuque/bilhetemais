import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createDb } from './db';
import { mailerFromEnv } from './mailer';
import { mpesaFromEnv } from './mpesa';
import { googleFromEnv } from './google';

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} em falta no .env`); return v; };
const db = createDb(process.env.PG_DATABASE ?? 'bilheteplus');
const port = Number(process.env.PORT ?? 4100);
createApp(db, { tokenSecret: need('TOKEN_SECRET'), webhookSecret: need('WEBHOOK_SECRET'), baseDomain: process.env.BASE_DOMAIN, simulator: process.env.PAYMENT_SIMULATOR === 'true', selfRegistration: process.env.SELF_REGISTRATION === 'true', mpesa: mpesaFromEnv(), google: googleFromEnv(), mpesaReconcileMs: 45_000, devAllowFraming: process.env.DEV_ALLOW_FRAMING === 'true' && process.env.NODE_ENV !== 'production', webDir: process.env.WEB_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)), loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT ?? 20), registerRateLimit: Number(process.env.REGISTER_RATE_LIMIT ?? 5), publicRateLimit: Number(process.env.PUBLIC_RATE_LIMIT ?? 60), mailer: mailerFromEnv(), publicUrl: process.env.PUBLIC_URL }).listen(port, () => console.log(`Bilhete+ API em :${port}`));
