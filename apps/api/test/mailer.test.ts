import { describe, expect, it } from 'vitest';
import { renderHtml } from '../src/mailer';

describe('e-mail HTML', () => {
  it('põe o logótipo no topo, transforma os links dos bilhetes em botões e escapa o texto', () => {
    const html = renderHtml('Olá <b>Ana</b>,\n\nBilhete 1: https://bilhetemais.live/t/abcDEF123\nVeja https://bilhetemais.live/account\n\nObrigado.');
    expect(html).toContain('src="https://bilhetemais.live/logo-email.png"'); // logótipo (PNG: os e-mails não mostram SVG)
    expect(html).toContain('Olá &lt;b&gt;Ana&lt;/b&gt;,'); // sem HTML injectado a partir do texto
    expect(html).not.toContain('<b>Ana</b>');
    expect(html).toMatch(/<a href="https:\/\/bilhetemais\.live\/t\/abcDEF123"[^>]*>Bilhete 1 →<\/a>/); // botão
    expect(html).toContain('<a href="https://bilhetemais.live/account" style="color:#4a1fe0">'); // link solto
  });
  it('usa o endereço configurado e não deixa aspas partir os atributos', () => {
    const html = renderHtml('x', 'https://exemplo.test/"><script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});
