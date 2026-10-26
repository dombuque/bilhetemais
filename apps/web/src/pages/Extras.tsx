import { useEffect, useMemo, useState } from 'react';
import { dt } from '../api';
import { Icon, Qr } from '../ui';
import { googleDirections, wazeDirections } from '../map/links';

/** Contagem decrescente até ao início (ou "a decorrer"). */
export function Countdown({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const start = +new Date(startsAt), end = +new Date(endsAt);
  if (now >= end) return <p className="pill">Evento terminado</p>;
  if (now >= start) return <p className="pill ok">● A decorrer agora</p>;
  const s = Math.floor((start - now) / 1000);
  const parts: [number, string][] = [[Math.floor(s / 86400), 'dias'], [Math.floor(s / 3600) % 24, 'horas'], [Math.floor(s / 60) % 60, 'min'], [s % 60, 'seg']];
  return (
    <div className="inline" role="timer" aria-label="Tempo até ao início" style={{ gap: 8, marginTop: 14 }}>
      {parts.map(([n, l]) => <div key={l} style={{ background: 'color-mix(in srgb, var(--brand-ink) 14%, transparent)', borderRadius: 12, padding: '6px 10px', textAlign: 'center', minWidth: 58 }}>
        <b style={{ fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums' }}>{String(n).padStart(2, '0')}</b><div style={{ fontSize: '.7rem', opacity: .85 }}>{l}</div></div>)}
    </div>
  );
}

/** Galeria: faixa deslizante + ampliação com navegação por teclado/toque. */
export function Gallery({ slug, items }: { slug: string; items: { id: string; caption: string | null }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % items.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + items.length) % items.length));
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, items.length]);
  if (!items.length) return null;
  const src = (id: string) => `/public/events/${slug}/images/${id}`;
  return (
    <section className="stack-sm">
      <h2>Galeria</h2>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: 6 }}>
        {items.map((g, i) => (
          <button key={g.id} onClick={() => setOpen(i)} aria-label={g.caption ?? `Imagem ${i + 1}`} style={{ flex: '0 0 78%', maxWidth: 360, padding: 0, border: 0, borderRadius: 16, overflow: 'hidden', scrollSnapAlign: 'start', background: 'var(--surface-2)', minHeight: 0 }}>
            <img src={src(g.id)} alt={g.caption ?? ''} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
          </button>
        ))}
      </div>
      {open !== null && (
        <div className="scrim" style={{ alignItems: 'center', background: 'rgb(0 0 0 / .9)' }} onClick={() => setOpen(null)} role="dialog" aria-modal="true" aria-label="Galeria">
          <figure style={{ margin: 0, maxWidth: '94vw', textAlign: 'center', color: '#fff' }} onClick={(e) => e.stopPropagation()}>
            <img src={src(items[open].id)} alt={items[open].caption ?? ''} style={{ maxWidth: '94vw', maxHeight: '76vh', borderRadius: 12 }} />
            <figcaption style={{ marginTop: 8 }}>{items[open].caption} <span style={{ opacity: .7 }}>({open + 1}/{items.length})</span></figcaption>
            <div className="inline" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button className="ghost" style={{ color: '#fff' }} onClick={() => setOpen((open - 1 + items.length) % items.length)} aria-label="Anterior"><Icon n="back" /></button>
              <button className="ghost" style={{ color: '#fff' }} onClick={() => setOpen(null)}>Fechar</button>
              <button className="ghost" style={{ color: '#fff', transform: 'scaleX(-1)' }} onClick={() => setOpen((open + 1) % items.length)} aria-label="Seguinte"><Icon n="back" /></button>
            </div>
          </figure>
        </div>
      )}
    </section>
  );
}

const icsDate = (d: string) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
/** Descarrega um ficheiro .ics (funciona com Google, Apple e Outlook). */
export function addToCalendar(items: { title: string; start: string; end?: string | null; location?: string | null; description?: string | null }[], filename: string) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bilhete+//PT', 'CALSCALE:GREGORIAN'];
  items.forEach((e, i) => lines.push('BEGIN:VEVENT', `UID:${i}-${icsDate(e.start)}@bilheteplus`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(e.start)}`,
    ...(e.end ? [`DTEND:${icsDate(e.end)}`] : []), `SUMMARY:${icsText(e.title)}`, ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []), ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []), 'END:VEVENT'));
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Programação agrupada por dia, com palco e botão de calendário por sessão. */
export function Programme({ items, eventName, location }: { items: any[]; eventName: string; location: string | null }) {
  const days = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const s of items) { const k = new Date(s.starts_at).toLocaleDateString('pt-MZ', { weekday: 'long', day: 'numeric', month: 'long' }); m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()];
  }, [items]);
  if (!items.length) return null;
  const time = (d: string) => new Date(d).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' });
  return (
    <section className="card stack">
      <div className="between"><h2>Programa</h2>
        <button className="ghost sm" onClick={() => addToCalendar(items.map((s) => ({ title: `${s.title} — ${eventName}`, start: s.starts_at, end: s.ends_at, location: s.stage ? `${s.stage}${location ? ', ' + location : ''}` : location, description: s.description })), 'programa.ics')}>Adicionar tudo ao calendário</button></div>
      {days.map(([day, list]) => (
        <div key={day}>
          <p className="muted small" style={{ textTransform: 'capitalize', fontWeight: 700 }}>{day}</p>
          {list.map((s) => (
            <div key={s.id} className="ticket-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 56, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{time(s.starts_at)}</div>
              <div style={{ flex: 1 }}><b>{s.title}</b>{s.stage && <span className="pill" style={{ marginLeft: 6 }}>{s.stage}</span>}{s.description && <p className="muted small">{s.description}</p>}</div>
            </div>))}
        </div>))}
    </section>
  );
}

/** Localização com ligação ao mapa e botões de calendário/partilha. */
export function WhereWhen({ ev }: { ev: any }) {
  const share = async () => {
    const data = { title: ev.name, text: ev.tagline ?? ev.name, url: location.href };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); alert_('Ligação copiada'); } } catch { /* cancelado */ }
  };
  const [msg, setMsg] = useState('');
  const hasGeo = typeof ev.lat === 'number' && typeof ev.lng === 'number';
  const alert_ = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2000); };
  return (
    <section className="card stack-sm">
      <p className="inline"><Icon n="calendar" /><span><b>{dt(ev.startsAt)}</b><br /><span className="muted small">até {dt(ev.endsAt)}</span></span></p>
      {ev.location && <p className="inline"><Icon n="pin" /><span><b>{ev.location}</b>{hasGeo ? <> · <a href={googleDirections(ev.lat, ev.lng)} target="_blank" rel="noopener noreferrer">Google Maps</a> · <a href={wazeDirections(ev.lat, ev.lng)} target="_blank" rel="noopener noreferrer">Waze</a></> : ev.mapUrl && <> · <a href={ev.mapUrl} target="_blank" rel="noopener noreferrer">Ver no mapa</a></>}</span></p>}
      <div className="inline">
        <button className="ghost sm" onClick={() => addToCalendar([{ title: ev.name, start: ev.startsAt, end: ev.endsAt, location: ev.location, description: ev.description }], 'evento.ics')}>📅 Calendário</button>
        <button className="ghost sm" onClick={share}><Icon n="copy" />{msg || 'Partilhar'}</button>
      </div>
    </section>
  );
}

/** Cartaz imprimível com o QR da página do evento (para divulgação). */
export function PosterQr({ url, name }: { url: string; name: string }) {
  return (
    <div className="stack center">
      <div className="ticket-print" style={{ display: 'block' }}><h2>{name}</h2><Qr value={url} label="QR da página do evento" /><p className="small">{url}</p></div>
    </div>
  );
}
