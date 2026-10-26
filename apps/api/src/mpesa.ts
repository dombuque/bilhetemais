import { constants, publicEncrypt } from 'node:crypto';

/**
 * Cliente M-Pesa Moçambique (Vodacom OpenAPI), pagamento C2B «single stage»: o cliente recebe no telemóvel o pedido de PIN.
 * Baseado na documentação pública do portal OpenAPI. Os códigos de resposta e os campos devem ser confirmados com as
 * credenciais de sandbox antes de ir para produção.
 */
export interface MpesaConfig {
  baseUrl: string;             // ex.: https://api.sandbox.vm.co.mz:18352   (produção: https://api.vm.co.mz:18352)
  apiKey: string;              // chave da API (nunca vai ao cliente)
  publicKey: string;           // chave pública RSA da Vodacom (PEM ou base64 DER)
  serviceProviderCode: string; // código do comerciante (shortcode)
  origin?: string;             // cabeçalho Origin registado no portal
  timeoutMs?: number;          // a chamada só responde quando o cliente confirma/recusa
  fetchImpl?: typeof fetch;
}
export type ChargeResult = { outcome: 'SUCCESS' | 'FAILED' | 'UNKNOWN'; code: string; message: string; transactionId?: string };
export type QueryResult = { outcome: 'SUCCESS' | 'FAILED' | 'PENDING'; code: string; message: string };
export interface Mpesa {
  charge(p: { msisdn: string; amountMinor: bigint; reference: string; thirdParty: string }): Promise<ChargeResult>;
  query(p: { reference: string; thirdParty: string }): Promise<QueryResult>;
}

/** Mensagens para o cliente (em português) por código de resposta. */
const MESSAGES: Record<string, string> = {
  'INS-0': 'Pagamento confirmado.',
  'INS-5': 'O pagamento foi cancelado no telemóvel.',
  'INS-6': 'O pagamento falhou. Tente de novo.',
  'INS-9': 'O M-Pesa não respondeu a tempo.',
  'INS-10': 'Pedido duplicado. Aguarde um momento e confirme o saldo.',
  'INS-15': 'Valor inválido.',
  'INS-16': 'O M-Pesa está sobrecarregado. Tente daqui a pouco.',
  'INS-2006': 'Saldo M-Pesa insuficiente.',
  'INS-2051': 'Número M-Pesa inválido.',
  'INS-995': 'Há um problema com a conta M-Pesa deste número.',
  'INS-996': 'A conta M-Pesa deste número não está activa.',
};
/** Respostas em que NÃO sabemos o resultado: nunca se dá o pagamento por falhado (o cliente pode ter pago). */
const UNKNOWN = new Set(['INS-9', 'INS-23', 'INS-1', 'INS-16']);

/** Aceita 84/85 + 7 dígitos, com ou sem +258/258/0. Devolve 258XXXXXXXXX ou null. */
export function normalizeMsisdn(input: string): string | null {
  let d = String(input ?? '').replace(/[\s().-]/g, '').replace(/^\+/, '');
  if (d.startsWith('00258')) d = d.slice(2);
  if (d.startsWith('258')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^(84|85)\d{7}$/.test(d) ? '258' + d : null;
}

/** 12500 centavos → "125" ; 12550 → "125.50". */
export const amountString = (minor: bigint) => `${minor / 100n}${minor % 100n ? '.' + String(minor % 100n).padStart(2, '0') : ''}`;

const toPem = (k: string) => (k.includes('BEGIN') ? k : `-----BEGIN PUBLIC KEY-----\n${k.replace(/\s+/g, '').match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`);

export function createMpesa(cfg: MpesaConfig): Mpesa {
  const f = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl.replace(/\/$/, '');
  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + publicEncrypt({ key: toPem(cfg.publicKey), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(cfg.apiKey)).toString('base64'),
    Origin: cfg.origin ?? '*',
  });

  return {
    async charge(p) {
      let body: any;
      try {
        const r = await f(`${base}/ipg/v1x/c2bPayment/singleStage/`, {
          method: 'POST', headers: headers(), signal: AbortSignal.timeout(cfg.timeoutMs ?? 100_000),
          body: JSON.stringify({
            input_TransactionReference: p.reference, input_CustomerMSISDN: p.msisdn, input_Amount: amountString(p.amountMinor),
            input_ThirdPartyReference: p.thirdParty, input_ServiceProviderCode: cfg.serviceProviderCode,
          }),
        });
        body = await r.json();
      } catch (e: any) {
        // rede, tempo esgotado ou resposta ilegível: o cliente pode ter pago; fica por confirmar
        return { outcome: 'UNKNOWN', code: 'NETWORK', message: 'Sem resposta do M-Pesa. Vamos verificar o pagamento.' };
      }
      const code = String(body?.output_ResponseCode ?? 'UNKNOWN');
      if (code === 'INS-0') return { outcome: 'SUCCESS', code, message: MESSAGES['INS-0'], transactionId: String(body.output_TransactionID ?? '') };
      if (UNKNOWN.has(code) || code === 'UNKNOWN') return { outcome: 'UNKNOWN', code, message: MESSAGES[code] ?? 'Estado do pagamento por confirmar.' };
      return { outcome: 'FAILED', code, message: MESSAGES[code] ?? 'O pagamento não foi concluído.' };
    },

    async query(p) {
      try {
        const qs = new URLSearchParams({ input_QueryReference: p.reference, input_ServiceProviderCode: cfg.serviceProviderCode, input_ThirdPartyReference: p.thirdParty });
        const r = await f(`${base}/ipg/v1x/queryTransactionStatus/?${qs}`, { method: 'GET', headers: headers(), signal: AbortSignal.timeout(30_000) });
        const body: any = await r.json();
        const code = String(body?.output_ResponseCode ?? 'UNKNOWN');
        const st = String(body?.output_ResponseTransactionStatus ?? '').toLowerCase();
        if (code === 'INS-0' && st === 'completed') return { outcome: 'SUCCESS', code, message: MESSAGES['INS-0'] };
        if (code === 'INS-0' && ['failed', 'cancelled', 'canceled', 'expired'].includes(st)) return { outcome: 'FAILED', code, message: MESSAGES['INS-6'] };
        return { outcome: 'PENDING', code, message: 'Pagamento ainda por confirmar.' };
      } catch {
        return { outcome: 'PENDING', code: 'NETWORK', message: 'Sem resposta do M-Pesa.' };
      }
    },
  };
}

/** Só fica activo se todas as variáveis estiverem definidas. */
export function mpesaFromEnv(env: NodeJS.ProcessEnv = process.env): Mpesa | null {
  const { MPESA_BASE_URL, MPESA_API_KEY, MPESA_PUBLIC_KEY, MPESA_SERVICE_PROVIDER_CODE } = env;
  if (!MPESA_BASE_URL || !MPESA_API_KEY || !MPESA_PUBLIC_KEY || !MPESA_SERVICE_PROVIDER_CODE) return null;
  return createMpesa({ baseUrl: MPESA_BASE_URL, apiKey: MPESA_API_KEY, publicKey: MPESA_PUBLIC_KEY, serviceProviderCode: MPESA_SERVICE_PROVIDER_CODE, origin: env.MPESA_ORIGIN });
}
