'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icon.tsx';

const LINKS: { href: string; label: string; icon: IconName; exact?: boolean }[] = [
  { href: '/films', label: 'Videos', icon: 'film' },
  { href: '/films/new', label: 'New video', icon: 'plus', exact: true },
  { href: '/settings', label: 'Settings', icon: 'gear' },
];

export function AppNav() {
  const pathname = usePathname();
  const current = (link: (typeof LINKS)[number]) => {
    if (link.exact) return pathname === link.href;
    if (link.href === '/films') return pathname === '/films' || /^\/films\/flm_/.test(pathname);
    return pathname.startsWith(link.href);
  };
  return (
    <nav aria-label="App">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} aria-current={current(link) ? 'page' : undefined}>
          <Icon name={link.icon} />
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
