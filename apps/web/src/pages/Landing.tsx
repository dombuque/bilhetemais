import { useEffect, useRef, useState } from 'react';
import './landing.css';
import { api, mt } from '../api';
import { Icon, Qr } from '../ui';

interface Ev { name: string; slug: string; startsAt: string; location: string | null; category: string | null; primary: string | null; minPriceMinor: string | null; cover: number | null }

const CATS: Record<string, string> = { MUSICA: 'Música', FESTIVAL: 'Festival', CONFERENCIA: 'Conferência', FEIRA: 'Feira', DESPORTO: 'Desporto', TEATRO: 'Teatro', GASTRONOMIA: 'Gastronomia', EMPRESARIAL: 'Empresarial', OUTRO: 'Outro' };
const QUICK: [string, string][] = [['?category=MUSICA', 'Música'], ['?category=FESTIVAL', 'Festival'], ['?category=GASTRONOMIA', 'Gastronomia'], ['?category=CONFERENCIA', 'Conferência'], ['?when=week', 'Esta semana'], ['?free=1', 'Grátis']];
const TICKER = ['Bilhetes online', 'Carteira cashless', 'Pulseiras NFC', 'QR e código de barras', 'POS para comerciantes', 'Portaria sem filas', 'Relatórios em tempo real', 'Em meticais'];
const TILES: { k: string; no: string; t: string; d: string; wide?: boolean }[] = [
  { k: 'v', no: '01', t: 'Bilhetes online e no balcão', d: 'Páginas de evento com a sua marca, lotes, categorias e stock em tempo real.' },
  { k: 'c', no: '02', t: 'Carteira cashless', d: 'Um saldo por participante, carregado por M-Pesa, e-Mola, cartão ou numerário.' },
  { k: 'p', no: '03', t: 'POS para comerciantes', d: 'Bares e bancas cobram com QR, código de barras ou pulseira, com comprovativo.' },
  { k: 'k', no: '04', t: 'Portaria sem filas', d: 'Validação instantânea, com câmara ou leitor, e modo offline com sincronização.' },
  { k: 'y', no: '05', t: 'Pulseiras e cartões NFC', d: 'Pague com um toque. Perdeu? Bloqueia e substitui sem perder o saldo.' },
  { k: 'v', no: '06', t: 'Relatórios que fecham', d: 'Receita de bilhética, carregamentos, acertos com comerciantes e reconciliação automática.', wide: true },
];
const STEPS: [string, string][] = [['Ligue a sua empresa', 'A equipa Bilhete+ cria a conta da empresa e dá acesso à sua equipa.'], ['Crie e personalize', 'Bilhetes, parâmetros, cores, imagens e local no mapa. Reaproveite outro evento.'], ['Venda, receba e controle', 'Bilhetes online e no balcão, pagamentos nos comerciantes, portaria e relatórios.']];

const price = (e: Ev) => (e.minPriceMinor === null ? 'Em breve' : BigInt(e.minPriceMinor) === 0n ? 'Grátis' : mt(e.minPriceMinor));
const dayTag = (d: string) => new Date(d).toLocaleDateString('pt-MZ', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '').toUpperCase();

export function Home({ canRegister }: { canRegister: boolean }) {
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<Ev[] | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const [solid, setSolid] = useState(false);
  useEffect(() => { const on = () => setSolid(window.scrollY > 24); on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on); }, []);
  useEffect(() => { api('GET', '/public/events?limit=8').then((r) => setEvents(r.items)).catch(() => setEvents([])); }, []);
  const go = (e: React.FormEvent) => { e.preventDefault(); location.assign('/eventos' + (q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '')); };
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * 400, behavior: 'smooth' });

  return (
    <div className="lp">
      {/* ===== HERO ===== */}
      <section className="lp-hero">
        <div className="lp-lines" aria-hidden="true" />
        <header className={'lp-nav' + (solid ? ' solid' : '')}>
          <a href="/" aria-label="Bilhete+"><img src={solid ? "/logo-dark.svg" : "/logo-white.svg"} alt="Bilhete+" /></a>
          <nav aria-label="Secções"><a href="/eventos">Eventos</a><a href="#o-que-fazemos">O que fazemos</a><a href="#inclusao">Sem smartphone</a><a href="#como-funciona">Como funciona</a></nav>
          <div className="go"><a className="lp-btn ghost sm" href="/staff">Entrar</a>{canRegister ? <a className="lp-btn sm" href="/registo">Registar empresa</a> : <a className="lp-btn sm" href="/eventos">Explorar</a>}</div>
        </header>

        <div className="lp-nav-space" aria-hidden="true" />
        <div className="lp-hero-body">
          <div className="lp-copy">
            <p className="lp-tag">Criamos momentos<br />sem filas.</p>
            <p className="lp-lead">Venda bilhetes, controle entradas e receba pagamentos no local com QR, pulseira ou cartão. Para quem tem smartphone e para quem não tem.</p>
            <form className="lp-search" onSubmit={go} role="search">
              <div className="box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar eventos, locais, organizadores" aria-label="Procurar eventos" /><button type="submit">Procurar</button></div>
              <div className="lp-chips">{QUICK.map(([qs, l]) => <a key={l} href={'/eventos' + qs}>{l}</a>)}</div>
            </form>
            <div className="lp-cta-row"><a className="lp-btn" href="/eventos"><Icon n="pin" />Explorar no mapa</a>{canRegister && <a className="lp-btn ghost" href="/registo">Registar empresa</a>}</div>
          </div>

          <div className="lp-stage" aria-hidden="true">
            <div className="lp-disc a" /><div className="lp-disc b" /><div className="lp-halftone" />
            <div className="lp-ticket cut">
              <div className="top"><small>BILHETE GERAL · Nº 0427</small><h3>Festival de Maputo</h3><p>SÁB 12 OUT · 18:00 · MACHAVA</p></div>
              <div className="perf" />
              <div className="bot"><Qr value="bilhete-plus-demonstracao" /></div>
            </div>
            <div className="lp-pill a"><span className="ic"><Icon n="wallet" /></span><span><small>Saldo</small><b>750,00 MT</b></span></div>
            <div className="lp-pill b"><span className="ic ok"><Icon n="check" /></span><span><small>Bar Central</small><b>Pago · 250,00 MT</b></span></div>
          </div>
        </div>

        <h1 className="lp-mark" aria-label="Bilhete+"><span>Bilhete</span><b>+</b></h1>
      </section>

      <div className="lp-marquee" aria-hidden="true"><div className="track">{[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}</span>)}</div></div>

      {/* ===== QUEM SOMOS ===== */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <span className="lp-label">BP/ Quem somos</span>
          <div className="lp-statement">
            <div style={{ position: 'relative' }}>
              <div className="lp-art-a cut"><span className="big">B+</span></div>
              <div className="lp-art-b cut-bl">Sem filas<br />sem dinheiro solto</div>
            </div>
            <div>
              <h2>Somos a plataforma que ajuda organizadores a vender, cobrar e <u>controlar</u> eventos, com bilhete no telemóvel, impresso ou na pulseira.</h2>
              <p className="lp-sub">Os grandes eventos raramente falham por falta de ideias, falham nas filas, no dinheiro e na porta. O Bilhete+ trata disso do primeiro bilhete ao último copo, em meticais.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PRÓXIMOS EVENTOS (dados reais) ===== */}
      <section className="lp-sec" style={{ paddingTop: 0 }} id="eventos">
        <div className="lp-wrap">
          <div className="lp-head">
            <div><span className="lp-label">BP/ Próximos eventos</span><h2>O que vem<br />a seguir</h2></div>
            <div className="nav"><button className="lp-arrow" onClick={() => scroll(-1)} aria-label="Anterior" style={{ transform: 'scaleX(-1)' }}><Icon n="arrowup" /></button><button className="lp-arrow" onClick={() => scroll(1)} aria-label="Seguinte"><Icon n="arrowup" /></button></div>
          </div>
          {events === null ? <div className="lp-empty"><p>A carregar eventos…</p></div> : events.length === 0 ? (
            <div className="lp-empty"><h3>Ainda não há eventos publicados</h3><p className="lp-sub" style={{ margin: 0 }}>Assim que os organizadores publicarem, aparecem aqui e no mapa.</p><a className="lp-btn dark" href="/eventos">Abrir o mapa</a></div>
          ) : (
            <div className="lp-events" ref={row}>
              {events.map((e) => (
                <a key={e.slug} href={`/e/${e.slug}`} className="ev cut">
                  <div className="img" style={{ background: e.cover ? `center / cover url(/public/events/${e.slug}/assets/cover?v=${e.cover})` : `linear-gradient(150deg, ${e.primary ?? '#5b2eff'}, color-mix(in srgb, ${e.primary ?? '#5b2eff'} 45%, #0b0820))` }} />
                  <span className="date">{dayTag(e.startsAt)}</span>{e.category && <span className="cat">{CATS[e.category] ?? e.category}</span>}
                  <div className="info"><h3>{e.name}</h3><p>{e.location ?? 'Local a anunciar'}</p><div className="row"><b>{price(e)}</b><i>Ver e comprar</i></div></div>
                </a>
              ))}
            </div>
          )}
          <div className="lp-cta-row" style={{ marginTop: 28 }}><a className="lp-btn dark" href="/eventos">Ver todos no mapa<Icon n="arrowup" /></a></div>
        </div>
      </section>

      {/* ===== O QUE FAZEMOS ===== */}
      <section className="lp-sec" style={{ paddingTop: 0 }} id="o-que-fazemos">
        <div className="lp-wrap">
          <div className="lp-head"><div><span className="lp-label">BP/ O que fazemos</span><h2>Tudo num<br />só lugar</h2></div></div>
          <div className="lp-tiles">
            {TILES.map((t) => (
              <article key={t.no} className={`tile cut ${t.k}${t.wide ? ' w' : ''}`}>
                <span className="no">[{t.no}]</span>
                <div className="foot"><div><h3>{t.t}</h3><p>{t.d}</p></div><span className="arrow"><Icon n="arrowup" /></span></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== INCLUSÃO ===== */}
      <section className="lp-sec lp-dark" id="inclusao">
        <div className="lp-wrap lp-incl">
          <div><span className="lp-label">BP/ Inclusão</span><h2>Sem smartphone? <em>Ninguém</em> fica à porta.</h2><p>Duas opções que dão acesso à mesma carteira e ao mesmo saldo, sem câmara, sem aplicação e sem internet no telemóvel do participante.</p></div>
          <div className="lp-opts">
            <div className="opt cut"><span className="ic"><Icon n="qr" /></span><div><h3>Bilhete impresso com QR</h3><ol><li>Compra no balcão e recebe o bilhete impresso</li><li>Carrega saldo no balcão, em numerário</li><li>Paga mostrando o bilhete ao comerciante</li></ol><div className="band">QR · código de barras</div></div></div>
            <div className="opt cut"><span className="ic"><Icon n="wallet" /></span><div><h3>Pulseira ou cartão NFC</h3><ol><li>O balcão associa a pulseira à sua carteira</li><li>Aproxima ao leitor para pagar</li><li>Perdeu? Bloqueia e substitui sem perder o saldo</li></ol><div className="band">Um toque · pago</div></div></div>
          </div>
        </div>
      </section>

      {/* ===== COMO FUNCIONA ===== */}
      <section className="lp-sec" id="como-funciona">
        <div className="lp-wrap">
          <div className="lp-head"><div><span className="lp-label">BP/ Como funciona</span><h2>Três passos<br />e está no ar</h2></div></div>
          <div className="lp-steps">{STEPS.map(([t, d], i) => <article className="step" key={t}><div className="n">0{i + 1}</div><h3>{t}</h3><p>{d}</p></article>)}</div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="lp-sec lp-cta">
        <div className="lp-wrap in">
          <span className="lp-label" style={{ color: '#fff' }}>BP/ Comece</span>
          <h2>Leve o seu evento para o digital.</h2>
          <div className="lp-cta-row"><a className="lp-btn" href="/eventos">Explorar eventos<Icon n="arrowup" /></a><a className="lp-btn ghost" href="/staff">Entrada da equipa</a>{canRegister && <a className="lp-btn ghost" href="/registo">Registar empresa</a>}</div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <div className="row"><span>© Bilhete+ · Moçambique</span><span><a href="/eventos">Eventos</a> · <a href="/staff">Equipa</a></span></div>
          <div className="giant" aria-hidden="true">Bilhete+</div>
        </div>
      </footer>
    </div>
  );
}
