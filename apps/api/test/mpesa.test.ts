import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { amountString, createMpesa, mpesaFromEnv, normalizeMsisdn } from '../src/mpesa';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const reply = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
const client = (fetchImpl: any) => createMpesa({ baseUrl: 'https://mpesa.test:18352/', apiKey: 'API-KEY-SECRETA', publicKey, serviceProviderCode: '171717', origin: 'bilhete.test', fetchImpl });

describe('M-Pesa — números e valores', () => {
  it('normaliza números de Moçambique (Vodacom 84/85) e recusa os outros', () => {
    expect(normalizeMsisdn('84 123 4567')).toBe('258841234567');
    expect(normalizeMsisdn('+258 85-123-4567')).toBe('258851234567');
    expect(normalizeMsisdn('0841234567')).toBe('258841234567');
    expect(normalizeMsisdn('00258841234567')).toBe('258841234567');
    for (const bad of ['', '82 123 4567', '86 123 4567', '8412345', '84123456789', 'abc', '258 84 123456']) expect(normalizeMsisdn(bad)).toBeNull();
  });
  it('formata o valor em meticais sem erros de vírgula flutuante', () => {
    expect(amountString(12500n)).toBe('125');
    expect(amountString(12550n)).toBe('125.50');
    expect(amountString(5n)).toBe('0.05');
    expect(amountString(100n)).toBe('1');
  });
});

describe('M-Pesa — cliente da API', () => {
  it('envia o pedido no formato esperado, com Bearer cifrado e sem expor a chave', async () => {
    let seen: any;
    const m = client(async (url: string, init: any) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ output_ResponseCode: 'INS-0', output_TransactionID: 'TX123' })); });
    const r = await m.charge({ msisdn: '258841234567', amountMinor: 25050n, reference: 'BPabc', thirdParty: 'BPabc' });
    expect(r).toMatchObject({ outcome: 'SUCCESS', transactionId: 'TX123' });
    expect(seen.url).toBe('https://mpesa.test:18352/ipg/v1x/c2bPayment/singleStage/');
    expect(seen.init.method).toBe('POST');
    expect(seen.init.headers.Origin).toBe('bilhete.test');
    expect(seen.body).toEqual({ input_TransactionReference: 'BPabc', input_CustomerMSISDN: '258841234567', input_Amount: '250.50', input_ThirdPartyReference: 'BPabc', input_ServiceProviderCode: '171717' });
    const bearer = String(seen.init.headers.Authorization);
    expect(bearer).toMatch(/^Bearer [A-Za-z0-9+/=]+$/);
    expect(Buffer.from(bearer.slice(7), 'base64')).toHaveLength(256); // RSA-2048 cifrado
    expect(bearer).not.toContain('API-KEY-SECRETA');
    const again = await m.charge({ msisdn: '258841234567', amountMinor: 100n, reference: 'x', thirdParty: 'x' });
    expect(again.outcome).toBe('SUCCESS');
  });

  it('distingue falha definitiva de resultado desconhecido (nunca dá como falhado o que pode ter sido pago)', async () => {
    const r = (code: string) => client(reply({ output_ResponseCode: code })).charge({ msisdn: '258841234567', amountMinor: 100n, reference: 'r', thirdParty: 'r' });
    expect(await r('INS-2006')).toMatchObject({ outcome: 'FAILED', message: 'Saldo M-Pesa insuficiente.' });
    expect(await r('INS-5')).toMatchObject({ outcome: 'FAILED' });
    expect(await r('INS-2051')).toMatchObject({ outcome: 'FAILED', message: 'Número M-Pesa inválido.' });
    for (const unknown of ['INS-9', 'INS-23', 'INS-1']) expect((await r(unknown)).outcome).toBe('UNKNOWN');
    const down = await client(async () => { throw new Error('ECONNRESET'); }).charge({ msisdn: '258841234567', amountMinor: 100n, reference: 'r', thirdParty: 'r' });
    expect(down).toMatchObject({ outcome: 'UNKNOWN', code: 'NETWORK' });
    const garbage = await client(async () => new Response('<html>502</html>', { status: 502 })).charge({ msisdn: '258841234567', amountMinor: 100n, reference: 'r', thirdParty: 'r' });
    expect(garbage.outcome).toBe('UNKNOWN');
  });

  it('consulta o estado da transacção', async () => {
    const q = (status: string, code = 'INS-0') => client(reply({ output_ResponseCode: code, output_ResponseTransactionStatus: status })).query({ reference: 'r', thirdParty: 'r' });
    expect((await q('Completed')).outcome).toBe('SUCCESS');
    expect((await q('Failed')).outcome).toBe('FAILED');
    expect((await q('Cancelled')).outcome).toBe('FAILED');
    expect((await q('Pending')).outcome).toBe('PENDING');
    expect((await q('Completed', 'INS-997')).outcome).toBe('PENDING'); // código de erro: não se assume sucesso
    expect((await client(async () => { throw new Error('x'); }).query({ reference: 'r', thirdParty: 'r' })).outcome).toBe('PENDING');
  });

  it('só fica activo com todas as variáveis de ambiente', () => {
    expect(mpesaFromEnv({} as any)).toBeNull();
    expect(mpesaFromEnv({ MPESA_BASE_URL: 'x', MPESA_API_KEY: 'k' } as any)).toBeNull();
    expect(mpesaFromEnv({ MPESA_BASE_URL: 'https://x', MPESA_API_KEY: 'k', MPESA_PUBLIC_KEY: publicKey, MPESA_SERVICE_PROVIDER_CODE: '1' } as any)).not.toBeNull();
  });
});
