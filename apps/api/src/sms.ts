/** Envio de SMS (códigos de confirmação). Só fica activo com um fornecedor configurado. */
export interface Sms { send(to: string, text: string): Promise<void> }

/** Número para o formato internacional (+258…): aceita «84 123 4567», «0841234567», «+258 84 123 4567», «00258…». */
export function normalizePhone(input: string, defaultCountry = '258'): string | null {
  let d = String(input ?? '').replace(/[\s().-]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^0?8[2-7]\d{7}$/.test(d)) d = defaultCountry + d.replace(/^0/, ''); // número local de Moçambique
  else if (/^8[2-7]\d{7}$/.test(d)) d = defaultCountry + d;
  if (!/^\d{8,15}$/.test(d)) return null;
  if (d.startsWith('258') && !/^258(8[2-7]\d{7})$/.test(d)) return null; // Moçambique: 9 dígitos, 82–87
  return '+' + d;
}

export function smsFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Sms | null {
  // Twilio (SMS por conta e número ou serviço de mensagens)
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    return {
      async send(to, text) {
        const body = new URLSearchParams({ To: to, Body: text });
        if (env.TWILIO_MESSAGING_SERVICE_SID) body.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID); else body.set('From', env.TWILIO_FROM!);
        const r = await fetchImpl(url, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error('twilio ' + r.status);
      },
    };
  }
  // Africa's Talking (muito usado em Moçambique)
  if (env.AT_USERNAME && env.AT_API_KEY) {
    const sandbox = env.AT_USERNAME === 'sandbox';
    const url = `https://api${sandbox ? '.sandbox' : ''}.africastalking.com/version1/messaging`;
    return {
      async send(to, text) {
        const body = new URLSearchParams({ username: env.AT_USERNAME!, to, message: text });
        if (env.AT_SENDER_ID) body.set('from', env.AT_SENDER_ID);
        const r = await fetchImpl(url, { method: 'POST', headers: { apiKey: env.AT_API_KEY!, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
        const j: any = await r.json().catch(() => ({}));
        const st = j?.SMSMessageData?.Recipients?.[0]?.statusCode;
        if (!r.ok || (st !== undefined && Number(st) >= 400)) throw new Error('africastalking ' + (st ?? r.status));
      },
    };
  }
  return null;
}
