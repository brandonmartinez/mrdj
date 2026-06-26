import { useState } from 'react';
import { NavLink, Outlet, useParams, Link } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Users, Tags, Wallet, Music, Menu } from 'lucide-react';
import { useSession } from '../context/session';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogPortal, DialogOverlay,
} from '@/components/ui/dialog';

const NAV = [
  { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: 'events',    label: 'Events',    icon: CalendarDays },
  { to: 'members',   label: 'Members',   icon: Users },
  { to: 'pricing',   label: 'Pricing',   icon: Tags },
  { to: 'earnings',  label: 'Earnings',  icon: Wallet },
];

export function OrgShell() {
  const { orgSlug = '' } = useParams();
  const { orgs } = useSession();
  const org = orgs.find((o) => o.slug === orgSlug);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <button
          onClick={() => setMobileNavOpen(true)}
          data-testid="mobile-nav-button"
          className="md:hidden rounded-md p-2 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to={`/o/${orgSlug}/dashboard`} className="flex items-center gap-2 font-semibold">
          <Music className="h-5 w-5 text-primary" />
          <span>mrdj</span>
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="truncate font-medium">{org?.name ?? orgSlug}</span>
        {org && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
            {org.role}
          </span>
        )}
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      {/* Mobile navigation drawer */}
      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent
            data-testid="mobile-nav-drawer"
            className="fixed left-0 top-0 h-full w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-r p-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex h-full flex-col">
              <div className="border-b px-4 py-4">
                <div className="flex items-center gap-2">
                  <Music className="h-5 w-5 text-primary" />
                  <span className="font-semibold">mrdj</span>
                </div>
                {org && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {org.name}
                  </p>
                )}
              </div>
              <nav className="flex-1 space-y-1 p-4">
                {NAV.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={`/o/${orgSlug}/${to}`}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </NavLink>
                ))}
              </nav>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <aside className="hidden w-48 shrink-0 md:block">
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={`/o/${orgSlug}/${to}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
