import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api';
import { Field, Icon, LangSwitch, Layout, PageHead, Skeleton, useAction, useToast } from '../ui';
import { themeStyle, type Theme } from '../theme';
import { Cashier } from './Cashier';
import { Company } from './Company';
import { Gate } from './Gate';
import { OrgAdmin } from './OrgAdmin';
import { Platform } from './Platform';
import { Pos } from './Pos';

interface OrgArea { name: string; slug: string; theme: Theme; logo: number | null }

function Login({ onDone, org, slug, canRegister, area }: { onDone: () => void; org?: OrgArea; slug?: string; canRegister?: boolean; area?: 'platform' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const submit = () => run(async () => {
    try { const r = await api('POST', '/auth/login', { email, password, org: slug ?? org?.slug, area, code: code || undefined }); setToken(r.token); onDone(); }
    catch (e: any) { if (e.code === 'MFA_REQUIRED') { setNeedCode(true); return; } throw e; }
  });
  const logo = org?.logo ? `/public/org/${org.slug}/logo?v=${org.logo}` : null;
  return (
    <div className={'login themed' + (org ? ' branded' : '')} style={org ? themeStyle(org.theme) : undefined}>
      <aside className="brandpane">
        <a href="/">{org ? (logo ? <img src={logo} alt={org.name} style={{ height: 52, maxWidth: 220, objectFit: 'contain', background: '#fff', borderRadius: 12, padding: '6px 12px' }} /> : <b style={{ font: '800 1.5rem var(--font-display)' }}>{org.name}</b>) : <img src="/logo-white.svg" alt="Bilhete+" style={{ height: 40 }} />}</a>
        <div className="stack">
          {area === 'platform' ? <span className="pp-tag plat">Bilhete+ · Plataforma</span> : org && <span className="pp-tag org">Empresa · Organizador</span>}
          <h1>{area === 'platform' ? 'Administração Bilhete+' : org ? `Área da equipa de ${org.name}` : 'Eventos sem filas. Pagamentos sem dinheiro solto.'}</h1>
          <p className="lead">{area === 'platform' ? 'Acesso reservado à equipa da Bilhete+: empresas, eventos e newsletter de toda a plataforma.' : org ? 'Entre com a conta que a sua empresa lhe atribuiu para vender, cobrar e controlar acessos.' : 'Bilhetes, carteira digital, pulseiras e leitura de QR para o seu evento, com a sua marca.'}</p>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
          {([['ticket', 'Bilhetes online e no balcão'], ['wallet', 'Carteira cashless e pulseiras NFC'], ['door', 'Portaria com validação instantânea']] as const).map(([ic, t]) => (
            <li key={t} className="inline" style={{ gap: 12, fontWeight: 600 }}><span style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgb(255 255 255 / .12)' }}><Icon n={ic} /></span>{t}</li>))}
        </ul>
        {org && <p className="small" style={{ opacity: .7 }}>Tecnologia Bilhete+</p>}
      </aside>
      <main className="formpane">
        <LangSwitch className="login-lang" />
        <div className="stack" style={{ width: 'min(400px, 100%)' }}>
          <a href="/" className="mobile-only" style={{ marginBottom: 8 }}>{org ? <b style={{ font: '800 1.3rem var(--font-display)' }}>{org.name}</b> : <img src="/logo.svg" alt="Bilhete+" style={{ height: 36 }} />}</a>
          <div><h1>Entrar</h1><p className="muted" style={{ marginTop: 6 }}>{area === 'platform' ? 'Administração da plataforma Bilhete+' : org ? `Equipa de ${org.name}` : 'Acesso da equipa e dos organizadores.'}</p></div>
          <Field label="E-mail"><input type="email" value={email} autoComplete="username" autoFocus onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Palavra-passe"><div className="pw"><input type={show ? 'text' : 'password'} value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /><button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Esconder palavra-passe' : 'Mostrar palavra-passe'}>{show ? 'Esconder' : 'Mostrar'}</button></div></Field>
          {needCode && <Field label="Código de verificação" hint="6 dígitos da app de autenticação, ou um código de recuperação."><input value={code} autoFocus inputMode="numeric" autoComplete="one-time-code" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>}
          <button className="big wide" disabled={busy || !email || !password || (needCode && !code)} onClick={submit}>{busy ? 'A entrar…' : needCode ? 'Verificar e entrar' : 'Entrar'}</button>
          {!org && canRegister && <p className="muted center">Organiza eventos? <a href="/register">Registe a sua empresa</a></p>}
        </div>
        {toast.node}
      </main>
    </div>
  );
}

/** Empresa registada mas ainda não aprovada (ou suspensa): só perfil, documentos e marca. */
function Onboarding({ me, reload }: { me: any; reload: () => void }) {
  const toast = useToast();
  return (
    <Layout me={me} nav={[{ id: 'empresa', label: 'A minha empresa', icon: 'building' }]} view="empresa" onView={() => {}}>
      <PageHead title="A minha empresa" sub="Complete os dados enquanto a sua empresa é validada." />
      <Company toast={toast.show} onStatus={reload} />
      {toast.node}
    </Layout>
  );
}

export function Staff({ orgSlug, area, cfg }: { orgSlug?: string; area?: 'platform'; cfg?: { selfRegistration: boolean } }) {
  const [me, setMe] = useState<any>(undefined);
  const [org, setOrg] = useState<OrgArea | null | undefined>(orgSlug ? undefined : null);
  useEffect(() => { if (orgSlug) api('GET', `/public/org/${orgSlug}`).then(setOrg).catch(() => setOrg(null)); }, [orgSlug]);
  // a app instalável da equipa: o manifesto traz o nome e o endereço da área (empresa ou plataforma)
  useEffect(() => {
    const href = area === 'platform' ? '/platform/manifest.webmanifest' : orgSlug ? `/company/${orgSlug}/manifest.webmanifest` : null;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!href || !link) return;
    const before = link.href; link.href = href;
    return () => { link.href = before; };
  }, [orgSlug, area]);
  const load = () => {
    if (!getToken()) return setMe(null);
    api('GET', '/me').then((m) => {
      // quem não pertence a esta empresa nunca vê a área dela: termina a sessão e pede nova entrada
      if (orgSlug && (m.role === 'PLATFORM_ADMIN' || m.orgSlug !== orgSlug)) { setToken(null); return setMe(null); }
      // a área da plataforma é só da equipa Bilhete+
      if (area === 'platform' && m.role !== 'PLATFORM_ADMIN') { setToken(null); return setMe(null); }
      setMe(m);
    }).catch(() => setMe(null));
  };
  useEffect(load, [orgSlug, area]);
  if (me === undefined || (orgSlug && org === undefined)) return <div className="main"><Skeleton /></div>;
  if (!me) return <Login onDone={load} org={org?.name ? org : undefined} slug={orgSlug} canRegister={cfg?.selfRegistration} area={area} />;
  if (me.role !== 'PLATFORM_ADMIN' && me.orgStatus !== 'ACTIVE') return <Onboarding me={me} reload={load} />;
  return (
    <>
      {me.role === 'PLATFORM_ADMIN' && <Platform me={me} />}
      {me.role === 'ORG_ADMIN' && <OrgAdmin me={me} />}
      {me.role === 'CASHIER' && <Cashier me={me} />}
      {me.role === 'MERCHANT_OPERATOR' && <Pos me={me} />}
      {me.role === 'GATE_OPERATOR' && <Gate me={me} />}
    </>
  );
}
