import nodemailer from 'nodemailer';
import type { Db, Tx } from './wallet';

export interface Mailer { send(to: string, subject: string, text: string, html?: string): Promise<void> }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Versão HTML de uma mensagem de texto: logótipo no topo, ligações clicáveis e rodapé. O texto simples continua a ir junto. */
export function renderHtml(text: string, baseUrl = 'https://bilhetemais.live'): string {
  const body = text.split('\n').map((line) => {
    const safe = esc(line);
    // uma linha «Rótulo: https://…» passa a botão; ligações soltas ficam clicáveis
    const m = /^(.*?):\s+(https?:\/\/\S+)$/.exec(line);
    if (m && /\/t\/|\/account|\/o\//.test(m[2])) return `<p style="margin:14px 0"><a href="${esc(m[2])}" style="display:inline-block;background:#5ce1ff;color:#0b0820;text-decoration:none;font-weight:700;padding:12px 18px">${esc(m[1])} →</a></p>`;
    return safe.length ? `<p style="margin:0 0 10px">${safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#4a1fe0">$1</a>')}</p>` : '<div style="height:8px"></div>';
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#0b0820">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff">
<tr><td style="padding:22px 28px;border-bottom:3px solid #5b2eff"><a href="${esc(baseUrl)}"><img src="${esc(baseUrl)}/logo-email.png" width="170" alt="Bilhete+" style="display:block;border:0"></a></td></tr>
<tr><td style="padding:26px 28px;font-size:15px;line-height:1.55">${body}</td></tr>
<tr><td style="padding:16px 28px;background:#0b0820;color:#c9c6e2;font-size:12px">Bilhete+ · Eventos sem filas, pagamentos sem dinheiro solto · <a href="${esc(baseUrl)}" style="color:#5ce1ff">${esc(baseUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
}

/** SMTP a partir de variáveis de ambiente; sem SMTP configurado devolve null (as mensagens ficam só na fila). */
export function mailerFromEnv(env = process.env): Mailer | null {
  if (!env.SMTP_HOST) return null;
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.SMTP_FROM ?? 'Bilhete+ <no-reply@localhost>';
  const baseUrl = env.PUBLIC_URL ?? 'https://bilhetemais.live';
  return { send: async (to, subject, text, html) => { await t.sendMail({ from, to, subject, text, html: html ?? renderHtml(text, baseUrl) }); } };
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
