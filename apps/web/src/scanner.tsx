import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/* ---------- NFC (Web NFC: Android + Chrome, em HTTPS) ---------- */
export const nfcSupported = () => typeof window !== 'undefined' && 'NDEFReader' in window;
export const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Extrai o código de um registo NDEF: texto simples ou ligação `.../t/<código>`. */
function codeFromRecords(records: any[]): string | null {
  for (const r of records) {
    if (r.recordType !== 'text' && r.recordType !== 'url') continue;
    const txt = new TextDecoder(r.encoding || 'utf-8').decode(r.data).trim();
    const m = /\/t\/([\w-]+)\/?$/.exec(txt);
    if (m) return m[1];
    if (txt) return txt;
  }
  return null;
}

/** Grava o código da credencial na pulseira/cartão NFC (NDEF). */
export async function writeNfcTag(code: string, signal?: AbortSignal) {
  if (!nfcSupported()) throw new Error('Este telemóvel/navegador não suporta NFC. Use Android com Chrome.');
  await new (window as any).NDEFReader().write({ records: [{ recordType: 'text', data: code }] }, { signal, overwrite: true });
}

/* ---------- câmara (ZXing: QR + códigos de barras em todos os navegadores) ---------- */
type Controls = { stop: () => void };

/**
 * Leitor de QR/código de barras/NFC pensado para telemóvel:
 * abre a câmara de imediato (`autoStart`), lê continuamente (`continuous`), lanterna e NFC quando disponíveis.
 * O campo de texto serve para leitores USB/Bluetooth e para escrever à mão.
 */
export function ScanInput({ onScan, placeholder = 'Ou escreva / use um leitor', autoStart, continuous, disabled, compact }: {
  onScan: (code: string) => void; placeholder?: string; autoStart?: boolean; continuous?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'idle' | 'camera' | 'nfc'>('idle');
  const [note, setNote] = useState('');
  const [torch, setTorch] = useState<boolean | null>(null); // null = sem suporte
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<Controls | null>(null);
  const last = useRef({ code: '', at: 0 });
  const cb = useRef(onScan); cb.current = onScan;
  const started = useRef(false);

  /** Evita ler o mesmo código várias vezes seguidas (leitura contínua). */
  const emit = useCallback((code: string) => {
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 2500) return;
    last.current = { code, at: now };
    try { navigator.vibrate?.(40); } catch { /* sem vibração */ }
    cb.current(code);
  }, []);

  const stopCamera = useCallback(() => { controls.current?.stop(); controls.current = null; setTorch(null); }, []);

  useEffect(() => {
    if (mode !== 'camera') return;
    let cancelled = false;
    (async () => {
      try {
        if (!window.isSecureContext) throw new Error('A câmara só funciona em ligação segura (HTTPS).');
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const hints = new Map<any, any>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13]], [DecodeHintType.TRY_HARDER, true]]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        const c = await reader.decodeFromConstraints({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } }, video.current!, (result) => {
          if (!result) return;
          emit(result.getText());
          if (!continuous) { setMode('idle'); }
        });
        if (cancelled) { c.stop(); return; }
        controls.current = c;
        const track = (video.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
        const caps: any = track?.getCapabilities?.();
        setTorch(caps && 'torch' in caps ? false : null);
        setNote('');
      } catch (e: any) {
        setNote(e?.name === 'NotAllowedError' ? 'Permita o acesso à câmara nas definições do navegador.' : e?.message ?? 'Não foi possível abrir a câmara.');
        setMode('idle');
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [mode, facing, continuous, emit, stopCamera]);

  // NFC: lê o código gravado na pulseira/cartão
  useEffect(() => {
    if (mode !== 'nfc') return;
    const ctl = new AbortController();
    (async () => {
      try {
        const nd = new (window as any).NDEFReader();
        await nd.scan({ signal: ctl.signal });
        setNote('Aproxime a pulseira ou o cartão da parte de trás do telemóvel.');
        nd.onreading = (e: any) => {
          const code = codeFromRecords(Array.from(e.message.records));
          if (code) { emit(code); if (!continuous) setMode('idle'); setNote(''); }
          else setNote('Esta pulseira não tem credencial Bilhete+. Peça ao balcão para a configurar.');
        };
        nd.onreadingerror = () => setNote('Não foi possível ler. Aproxime de novo.');
      } catch (e: any) { setNote(e?.name === 'NotAllowedError' ? 'Permita o NFC para este site.' : 'Não foi possível activar o NFC.'); setMode('idle'); }
    })();
    return () => ctl.abort();
  }, [mode, continuous, emit]);

  // em telemóvel, abre a câmara logo
  useEffect(() => { if (autoStart && !started.current && !disabled && isTouchDevice()) { started.current = true; setMode('camera'); } }, [autoStart, disabled]);
  useEffect(() => { if (disabled && !continuous) setMode('idle'); }, [disabled, continuous]);
  useEffect(() => () => stopCamera(), [stopCamera]);

  const toggleTorch = async () => {
    const track = (video.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    try { await track?.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { /* sem lanterna */ }
  };
  // aceita o código com espaços (como aparece sob o QR) ou a ligação completa /t/<código>
  const submit = () => { const raw = text.trim(); const m = /\/t\/([\w-]+)\/?$/.exec(raw); const v = m ? m[1] : raw.replace(/\s+/g, ''); if (v) { emit(v); setText(''); } };
  const camOn = mode === 'camera';

  return (
    <div className="scanner stack-sm">
      {camOn && (
        <div className="viewfinder">
          <video ref={video} muted playsInline autoPlay />
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="vf-actions">
            {torch !== null && <button type="button" className={'ghost sm' + (torch ? ' on' : '')} onClick={toggleTorch} aria-pressed={torch} aria-label="Lanterna">Lanterna</button>}
            <button type="button" className="ghost sm" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')} aria-label="Trocar de câmara">Trocar câmara</button>
            <button type="button" className="ghost sm" onClick={() => setMode('idle')}>Fechar</button>
          </div>
          <p className="vf-hint">Aponte ao QR ou código de barras</p>
        </div>
      )}
      {!camOn && (
        <div className={'scan-actions' + (compact ? ' compact' : '')}>
          <button type="button" className="big" disabled={disabled} onClick={() => { setNote(''); setMode('camera'); }}><Icon n="scan" />Ler com a câmara</button>
          {nfcSupported() && <button type="button" className={'big ghost' + (mode === 'nfc' ? ' on' : '')} disabled={disabled} onClick={() => { setNote(''); setMode(mode === 'nfc' ? 'idle' : 'nfc'); }}><Icon n="wallet" />{mode === 'nfc' ? 'A ler NFC… (tocar para parar)' : 'Ler pulseira NFC'}</button>}
        </div>
      )}
      {note && <p className="scan-note" role="status">{note}</p>}
      <div className="inline" style={{ flexWrap: 'nowrap' }}>
        <input value={text} disabled={disabled} placeholder={placeholder} aria-label="Código lido" autoComplete="off" autoCapitalize="off" spellCheck={false}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button type="button" onClick={submit} disabled={disabled || !text.trim()} aria-label="Confirmar código"><Icon n="check" /></button>
      </div>
    </div>
  );
}
