import { describe, expect, it } from 'vitest';
import { normalizePhone, smsFromEnv } from '../src/sms';

describe('SMS: smsserviceapi', () => {
  it('envia o número nacional (sem +258) com a chave e a mensagem; falha quando o fornecedor recusa', async () => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    const ok = (async (url: any, init: any) => { calls.push({ url: String(url), body: init.body }); return { ok: true, status: 200, json: async () => ({ enviada: true, mensagem: 'ok' }) } as any; }) as typeof fetch;
    const sms = smsFromEnv({ SMSSERVICE_SECRET_KEY: 'chave-de-teste' } as any, ok)!;
    expect(sms).toBeTruthy();
    await sms.send(normalizePhone('84 123 4567')!, 'O seu código: 123456');
    expect(calls[0].url).toBe('https://api.smsserviceapi.com/api/externa/send');
    expect(calls[0].body.get('number')).toBe('841234567');
    expect(calls[0].body.get('secretKey')).toBe('chave-de-teste');
    expect(calls[0].body.get('message')).toBe('O seu código: 123456');
    const bad = (async () => ({ ok: false, status: 400, json: async () => ({ enviada: false, mensagem: 'saldo insuficiente' }) }) as any) as typeof fetch;
    await expect(smsFromEnv({ SMSSERVICE_SECRET_KEY: 'x' } as any, bad)!.send('+258841234567', 'x')).rejects.toThrow(/saldo insuficiente/);
    expect(smsFromEnv({} as any)).toBeNull(); // sem fornecedor, o login por telemóvel fica escondido
  });
});
