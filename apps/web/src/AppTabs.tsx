import { Icon } from './ui';
import { useAccountName } from './accountName';

/** Barra de separadores em baixo (como numa app nativa): onde se vêem os eventos, os bilhetes e o perfil. */
export function AppTabs({ current }: { current: 'events' | 'tickets' | 'profile' }) {
  const name = useAccountName();
  const tabs = [
    { id: 'events', href: '/events', label: 'Eventos', icon: 'pin' },
    { id: 'tickets', href: '/account', label: 'Bilhetes', icon: 'ticket' },
    { id: 'profile', href: '/account/profile', label: name ?? 'Perfil', icon: 'users' },
  ] as const;
  return (
    <nav className="app-tabs" aria-label="Navegação principal">
      {tabs.map((t) => (
        <a key={t.id} href={t.href} className={t.id === current ? 'on' : ''} aria-current={t.id === current ? 'page' : undefined}>
          <Icon n={t.icon} /><span>{t.label}</span>
        </a>))}
    </nav>
  );
}
