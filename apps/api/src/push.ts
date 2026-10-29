import webpush from 'web-push';

/** Notificações push (PWA): um aviso no telemóvel mesmo com a app fechada. Só fica activo com chaves VAPID. */
export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface PushMessage { title: string; body: string; url: string; tag?: string }
export interface Push {
  publicKey: string;
  /** Envia a uma subscrição. Rejeita com `statusCode` 404/410 quando a subscrição já não existe. */
  send(sub: PushSub, msg: PushMessage): Promise<void>;
}

export function pushFromEnv(env: NodeJS.ProcessEnv = process.env): Push | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  webpush.setVapidDetails(env.VAPID_SUBJECT ?? 'mailto:noreplay@bilhetemais.live', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return {
    publicKey: VAPID_PUBLIC_KEY,
    async send(sub, msg) {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 24, urgency: 'normal' });
    },
  };
}
