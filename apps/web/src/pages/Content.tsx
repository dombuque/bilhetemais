import { locale } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, dt, getToken, shrinkImage, upload } from '../api';
import { ConfirmButton, Empty, Field, Icon, useAction } from '../ui';
import { LocationPicker } from '../map/Maps';

type Toast = (m: string, e?: boolean) => void;

/** Imagem protegida: o servidor exige sessão, por isso carrega-se com o token. */
function AuthImg({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    fetch(src, { headers: { authorization: 'Bearer ' + getToken() } }).then((r) => r.blob()).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => {});
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [src]);
  return url ? <img src={url} alt={alt} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 12, display: 'block' }} /> : <div className="skeleton" style={{ aspectRatio: '4 / 3', height: 'auto' }} />;
}

/** Detalhes, galeria de imagens e programação do evento. As imagens ficam guardadas na base de dados. */
export function ContentTab({ id, ev, toast, onChange }: { id: string; ev: any; toast: Toast; onChange: () => void }) {
  const [d, setD] = useState<any>({ name: ev.name, description: ev.description ?? '', location: ev.location ?? '', mapUrl: ev.map_url ?? '', category: ev.category ?? '', latitude: ev.latitude === null || ev.latitude === undefined ? null : Number(ev.latitude), longitude: ev.longitude === null || ev.longitude === undefined ? null : Number(ev.longitude) });
  const [images, setImages] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [s, setS] = useState({ title: '', startsAt: '', endsAt: '', stage: '' });
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction(toast);
  const load = useCallback(async () => { setImages(await api('GET', `/events/${id}/images`)); setSessions(await api('GET', `/events/${id}/sessions`)); }, [id]);
  useEffect(() => { load(); }, [load]);

  const add = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]; e.target.value = '';
    for (const f of files) await run(async () => { await upload('POST', `/events/${id}/images`, await shrinkImage(f, 1600), { 'x-caption': '' }); }, undefined);
    await load(); toast(files.length > 1 ? 'Imagens adicionadas' : 'Imagem adicionada');
  };
  const move = (i: number, dir: -1 | 1) => {
    const ids = images.map((x) => x.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(async () => { await api('PUT', `/events/${id}/images-order`, { ids }); await load(); });
  };
  return (
    <div className="stack">
      <div className="card stack">
        <h3>Detalhes</h3>
        <Field label="Nome"><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Descrição"><textarea rows={4} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
        <Field label="Categoria" hint="Ajuda os participantes a encontrar o evento na pesquisa."><select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}><option value="">Sem categoria</option>{[['MUSICA', 'Música'], ['FESTIVAL', 'Festival'], ['CONFERENCIA', 'Conferência'], ['FEIRA', 'Feira'], ['DESPORTO', 'Desporto'], ['TEATRO', 'Teatro'], ['GASTRONOMIA', 'Gastronomia'], ['EMPRESARIAL', 'Empresarial'], ['OUTRO', 'Outro']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="field-row">
          <Field label="Local"><input value={d.location} onChange={(e) => setD({ ...d, location: e.target.value })} /></Field>
          <Field label="Ligação do mapa" hint="Cole a ligação do Google Maps (https://…)."><input value={d.mapUrl} placeholder="https://maps.google.com/…" onChange={(e) => setD({ ...d, mapUrl: e.target.value })} /></Field>
        </div>
        <div className="stack-sm"><label className="lbl">Local no mapa</label>
          <LocationPicker lat={d.latitude} lng={d.longitude} onChange={(la, lo) => setD({ ...d, latitude: la, longitude: lo })} onPlaceName={(n) => !d.location && setD((x: any) => ({ ...x, location: n }))} /></div>
        <button disabled={busy} onClick={() => run(async () => { await api('PUT', `/events/${id}/details`, d); onChange(); }, 'Detalhes guardados')}>Guardar detalhes</button>
      </div>

      <div className="card stack">
        <div className="between"><h3>Galeria ({images.length}/12)</h3>
          <span><input ref={file} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={add} /><button className="sm" disabled={busy || images.length >= 12} onClick={() => file.current?.click()}><Icon n="plus" />Adicionar imagens</button></span></div>
        <p className="muted small">Aparecem na página pública do evento, por esta ordem. São reduzidas automaticamente e guardadas na base de dados.</p>
        {images.length === 0 ? <Empty icon="box">Sem imagens.</Empty> : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>{images.map((g, i) => (
            <div key={g.id} className="stack-sm">
              <AuthImg src={`/events/${id}/images/${g.id}/file`} alt={g.caption ?? `Imagem ${i + 1}`} />
              <input aria-label="Legenda" defaultValue={g.caption ?? ''} placeholder="Legenda" maxLength={140} onBlur={(e) => e.target.value !== (g.caption ?? '') && run(async () => { await api('PATCH', `/events/${id}/images/${g.id}`, { caption: e.target.value }); await load(); })} />
              <div className="inline"><button className="ghost sm" aria-label="Mover para trás" disabled={i === 0} onClick={() => move(i, -1)}>←</button><button className="ghost sm" aria-label="Mover para a frente" disabled={i === images.length - 1} onClick={() => move(i, 1)}>→</button>
                <ConfirmButton label="Remover" confirmLabel="Confirmar" className="danger ghost sm" onConfirm={() => run(async () => { await api('DELETE', `/events/${id}/images/${g.id}`); await load(); })} /></div>
            </div>))}</div>)}
      </div>

      <div className="card stack">
        <h3>Programa</h3>
        {sessions.length === 0 ? <Empty icon="chart">Sem sessões. Adicione actuações, palestras ou momentos do evento.</Empty> : sessions.map((x) => (
          <div className="between" key={x.id}><span><b>{x.title}</b>{x.stage && <span className="pill" style={{ marginLeft: 6 }}>{x.stage}</span>}<br /><small className="muted">{dt(x.starts_at)}{x.ends_at ? ` → ${new Date(x.ends_at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}` : ''}</small></span>
            <ConfirmButton label="Remover" confirmLabel="Confirmar" className="danger ghost sm" onConfirm={() => run(async () => { await api('DELETE', `/events/${id}/sessions/${x.id}`); await load(); })} /></div>))}
        <div className="field-row">
          <Field label="Título"><input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></Field>
          <Field label="Palco / sala"><input value={s.stage} onChange={(e) => setS({ ...s, stage: e.target.value })} /></Field>
          <Field label="Início"><input type="datetime-local" value={s.startsAt} onChange={(e) => setS({ ...s, startsAt: e.target.value })} /></Field>
          <Field label="Fim (opcional)"><input type="datetime-local" value={s.endsAt} onChange={(e) => setS({ ...s, endsAt: e.target.value })} /></Field>
        </div>
        <button disabled={busy || !s.title || !s.startsAt} onClick={() => run(async () => {
          await api('POST', `/events/${id}/sessions`, { title: s.title, stage: s.stage, startsAt: new Date(s.startsAt).toISOString(), endsAt: s.endsAt ? new Date(s.endsAt).toISOString() : undefined });
          setS({ title: '', startsAt: '', endsAt: '', stage: '' }); await load();
        }, 'Sessão adicionada')}>Adicionar ao programa</button>
      </div>
    </div>
  );
}
