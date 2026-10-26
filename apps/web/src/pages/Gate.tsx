import { useCallback, useEffect, useRef, useState } from 'react';
import { api, dt } from '../api';
import { loadManifest, loadQueue, newClientId, saveManifest, saveQueue, validateLocal, type QueuedScan } from '../gateOffline';
import { Empty, FullResult, Icon, Layout, PageHead, ScanInput, Skeleton, useToast } from '../ui';

const TEXT: Record<string, string> = { VALID: 'ENTRADA VÁLIDA', ALREADY_USED: 'JÁ UTILIZADO', EXPIRED: 'EXPIRADO', REVOKED: 'REVOGADO', UNAUTHORIZED: 'NÃO AUTORIZADO', ERROR: 'ERRO DE LEITURA' };
const SHORT: Record<string, string> = { VALID: 'Válido', ALREADY_USED: 'Já utilizado', EXPIRED: 'Expirado', REVOKED: 'Revogado', UNAUTHORIZED: 'Não autorizado', ERROR: 'Erro' };

export function Gate({ me }: { me: any }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [eid, setEid] = useState('');
  const [gates, setGates] = useState<any[]>([]);
  const [gate, setGate] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [result, setResult] = useState<{ kind: string; offline: boolean; ticket?: { type: string; holder: string; usedAt: string | null; firstGate: string | null } | null } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [manifestInfo, setManifestInfo] = useState<{ count: number; at: string } | null>(null);
  const showing = useRef(false); // com resultado no ecrã, novas leituras são ignoradas
  const toast = useToast();

  useEffect(() => { api('GET', '/events').then((e) => { setEvents(e); if (e[0]) setEid(e[0].id); }); }, []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const refreshLocal = useCallback((id: string) => {
    setQueue(loadQueue(id));
    const m = loadManifest(id);
    setManifestInfo(m ? { count: m.tickets.length, at: m.generatedAt } : null);
  }, []);
  const load = useCallback(async () => {
    if (!eid) return;
    try { setStats(await api('GET', `/events/${eid}/gate-stats`)); setGates(await api('GET', `/events/${eid}/gates`)); } catch { /* offline: mantém o último estado */ }
  }, [eid]);
  useEffect(() => { load(); refreshLocal(eid); }, [load, refreshLocal, eid]);

  /** Descarrega a lista de bilhetes para poder validar sem rede. */
  const prepareOffline = async () => {
    try {
      const m = await api('GET', `/events/${eid}/gate-manifest`);
      if (!saveManifest(eid, m)) throw new Error('Sem espaço no dispositivo para guardar a lista.');
      refreshLocal(eid); toast.show(`Modo offline preparado: ${m.tickets.length} bilhetes`);
    } catch (e: any) { toast.show(e.message ?? 'Não foi possível preparar o modo offline', true); }
  };

  /** Envia as leituras guardadas; o servidor ignora repetições e sinaliza conflitos entre portas. */
  const sync = useCallback(async () => {
    const q = loadQueue(eid);
    if (!q.length || !navigator.onLine || (window as any).__forceOffline === true) return;
    try {
      const r = await api('POST', `/events/${eid}/scan-batch`, { scans: q });
      saveQueue(eid, []); refreshLocal(eid); load();
      toast.show(r.conflicts ? `${q.length} leituras sincronizadas, ${r.conflicts} em conflito (bilhete já usado noutra porta)` : `${q.length} leituras sincronizadas`, r.conflicts > 0);
      const m = await api('GET', `/events/${eid}/gate-manifest`); saveManifest(eid, m); refreshLocal(eid); // refresca a lista com o que as outras portas fizeram
    } catch { /* tenta de novo mais tarde */ }
  }, [eid, load, refreshLocal, toast]);
  useEffect(() => { if (online) sync(); }, [online, sync]);
  useEffect(() => { const t = setInterval(sync, 20000); return () => clearInterval(t); }, [sync]);

  const scan = useCallback(async (token: string) => {
    if (showing.current) return;
    showing.current = true;
    const forceOffline = (window as any).__forceOffline === true; // para testes locais
    const offlineScan = async () => {
      const m = loadManifest(eid);
      if (!m) { setResult({ kind: 'ERROR', offline: true }); return; }
      const v = await validateLocal(m, token);
      saveManifest(eid, v.manifest);
      saveQueue(eid, [...loadQueue(eid), { clientId: newClientId(), token, at: new Date().toISOString(), gateId: gate || undefined, localResult: v.result }]);
      refreshLocal(eid);
      setResult({ kind: v.result, offline: true });
    };
    try {
      if (!navigator.onLine || forceOffline) await offlineScan();
      else { const r = await api('POST', `/events/${eid}/scan`, { token, gateId: gate || undefined }); setResult({ kind: r.result, offline: false, ticket: r.ticket }); }
    } catch (e: any) {
      // falha de rede (sem resposta do servidor): se houver lista local, valida offline
      if (e?.status === undefined && loadManifest(eid)) await offlineScan(); else setResult({ kind: 'ERROR', offline: false });
    }
    load();
  }, [eid, gate, load, refreshLocal]);

  const pct = stats && stats.issued ? Math.round((stats.entered / stats.issued) * 100) : 0;
  const offlineNow = !online || (window as any).__forceOffline === true;
  return (
    <Layout me={me} nav={[{ id: 'scan', label: 'Leitura', icon: 'scan' }]} view="scan" onView={() => {}}>
      <PageHead title="Controlo de acessos" actions={<>
        {events && events.length > 1 && <select aria-label="Evento" value={eid} onChange={(e) => setEid(e.target.value)}>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}
        <select aria-label="Porta" value={gate} onChange={(e) => setGate(e.target.value)}><option value="">Todas as portas</option>{gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></>} />
      {!events ? <Skeleton rows={3} /> : events.length === 0 ? <Empty icon="door">Sem eventos activos.</Empty> : <div className="stack">
        <div className="card"><ScanInput onScan={scan} disabled={result !== null} autoStart continuous placeholder="Digitar o código do bilhete" /></div>

        <div className="card flat between">
          <span className="inline"><span className={'pill ' + (offlineNow ? 'warn' : 'ok')}>{offlineNow ? 'Sem rede' : 'Online'}</span>
            <span className="small muted">{manifestInfo ? `Offline preparado: ${manifestInfo.count} bilhetes · ${dt(manifestInfo.at)}` : 'Modo offline não preparado'}</span></span>
          <span className="inline">
            <button className="ghost sm" disabled={offlineNow} onClick={prepareOffline}><Icon n="arrowdown" />{manifestInfo ? 'Actualizar lista' : 'Preparar offline'}</button>
            {queue.length > 0 && <button className="sm" disabled={offlineNow} onClick={sync}>Sincronizar ({queue.length})</button>}
          </span>
        </div>

        {stats && <div className="kpis"><div className="kpi"><span>Entradas</span><b>{stats.entered}</b><small>{pct}% dos {stats.issued} bilhetes emitidos</small></div>
          <div className="kpi"><span>Por entrar</span><b>{Math.max(0, stats.issued - stats.entered)}</b></div></div>}
        {stats && <div className="card"><h3>Últimas leituras</h3>{stats.recent.length === 0 ? <p className="muted">Ainda sem leituras.</p> :
          <table><tbody>{stats.recent.map((r: any, i: number) => <tr key={i}><td>{dt(r.created_at)}</td><td className="right"><span className={'pill ' + (r.result === 'VALID' ? 'ok' : r.result === 'ALREADY_USED' || r.result === 'EXPIRED' ? 'warn' : 'bad')}>{SHORT[r.result] ?? r.result}</span></td></tr>)}</tbody></table>}</div>}
      </div>}
      {result && <FullResult kind={result.kind} title={TEXT[result.kind] ?? result.kind} detail={result.offline ? 'Validado sem rede · será sincronizado' : result.ticket ? <><b>{result.ticket.holder}</b><br />{result.ticket.type}{result.kind === 'ALREADY_USED' && result.ticket.usedAt ? <><br />Já entrou às {new Date(result.ticket.usedAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}{result.ticket.firstGate ? ` · ${result.ticket.firstGate}` : ''}</> : null}</> : undefined}
        onClose={() => { showing.current = false; setResult(null); }} autoCloseMs={result.kind === 'VALID' ? 2600 : undefined} />}
      {toast.node}
    </Layout>
  );
}
