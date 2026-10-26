import nodemailer from 'nodemailer';
import type { Db, Tx } from './wallet';

export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }

/** SMTP a partir de variáveis de ambiente; sem SMTP configurado devolve null (as mensagens ficam só na fila). */
export function mailerFromEnv(env = process.env): Mailer | null {
  if (!env.SMTP_HOST) return null;
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.SMTP_FROM ?? 'Bilhete+ <no-reply@localhost>';
  return { send: async (to, subject, text) => { await t.sendMail({ from, to, subject, text }); } };
}

/** Regista a mensagem e tenta enviá-la fora do pedido; falhas ficam registadas e nunca quebram a operação. */
export async function queueMail(db: Db, mailer: Mailer | null, tx: Tx, p: { to: string; subject: string; text: string; organizationId?: string }) {
  const r = await tx.query<{ id: string }>('INSERT INTO notifications(to_email,subject,body,organization_id,status) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [p.to, p.subject, p.text, p.organizationId ?? null, mailer ? 'PENDING' : 'SKIPPED']);
  const id = r.rows[0].id;
  if (!mailer) return;
  // só depois de a transacção do chamador confirmar é que o envio é tentado
  setTimeout(() => {
    mailer.send(p.to, p.subject, p.text)
      .then(() => db.query(`UPDATE notifications SET status='SENT',sent_at=now() WHERE id=$1`, [id]))
      .catch((e) => db.query(`UPDATE notifications SET status='FAILED',error=$2 WHERE id=$1`, [id, String(e?.message ?? e).slice(0, 300)]).catch(() => {}));
  }, 250);
}
