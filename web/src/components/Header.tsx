import { useRef, useEffect } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface HeaderProps {
  eventName: string;
  displayName: string;
  role: string;
  creditBalance: number;
  onRoleSwitch: (role: 'guest' | 'admin') => Promise<void>;
  view?: 'guest' | 'console';
  onToggleView?: () => void;
  orgName?: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  onBuyCredits?: () => void;
}

export function Header({
  eventName,
  displayName,
  role,
  creditBalance,
  onRoleSwitch,
  view,
  onToggleView,
  orgName,
  logoUrl,
  accentColor,
  onBuyCredits,
}: HeaderProps) {
  const headerRef = useRef<HTMLElement>(null);

  // Expose header height as --header-h CSS variable for scroll math
  useEffect(() => {
    const update = () => {
      const h = headerRef.current?.offsetHeight ?? 64;
      document.documentElement.style.setProperty('--header-h', `${h}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  const isAdmin = role === 'admin';
  const showDevControls = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-zinc-800"
    >
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 min-w-0">
          {logoUrl ? (
            <img src={logoUrl} alt={orgName ?? 'logo'} className="h-8 w-8 rounded-md object-cover flex-shrink-0" />
          ) : (
            <span className="text-2xl" aria-hidden>🎵</span>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-black tracking-tight text-white leading-none" style={accentColor ? { color: accentColor } : undefined}>
              {orgName ?? 'mrdj'}
            </h1>
            <p className="text-xs text-zinc-500 truncate hidden sm:block">{eventName}</p>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* DJ Console toggle (admin only) */}
          {isAdmin && onToggleView && (
            <button
              onClick={onToggleView}
              aria-pressed={view === 'console'}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                view === 'console'
                  ? 'bg-yellow-700 text-white border-yellow-600'
                  : 'bg-zinc-900 text-yellow-300 border-yellow-700/50 hover:bg-zinc-800'
              }`}
            >
              {view === 'console' ? '← Guest View' : '🎛 DJ Console'}
            </button>
          )}

          {/* Credit balance — now a button */}
          <button
            data-testid="header-buy-credits"
            onClick={onBuyCredits}
            className="text-right hover:opacity-80 transition-opacity"
            aria-label={`${creditBalance} credits — click to buy more`}
          >
            <p className="text-xs text-zinc-500 leading-none">credits</p>
            <p className="text-xl font-black text-violet-400 leading-none tabular-nums">
              {creditBalance}
            </p>
          </button>

          {/* User dropdown menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="header-user-menu"
                className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-full px-3 py-1.5 hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-label="User menu"
              >
                <span className="text-xs text-zinc-400">{displayName}</span>
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                  isAdmin
                    ? 'bg-yellow-900/60 text-yellow-300'
                    : 'bg-violet-900/60 text-violet-300'
                }`}>
                  {role}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-zinc-900 border-zinc-700">
              <DropdownMenuLabel className="text-zinc-400">
                {displayName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-zinc-800" />
              
              {/* Dev role switcher — moved into the menu */}
              {showDevControls && (
                <>
                  <DropdownMenuLabel className="text-zinc-500 text-xs">
                    Dev Controls
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    data-testid="header-role-switch"
                    onClick={() => void onRoleSwitch(isAdmin ? 'guest' : 'admin')}
                    className="text-zinc-300 hover:bg-zinc-800 focus:bg-zinc-800 cursor-pointer"
                  >
                    Switch to {isAdmin ? 'Guest' : 'Admin'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
