import { cn } from '@/lib/utils';

interface HeroBannerProps {
  heroUrl: string | null | undefined;
  accent: string;
  alt: string;
  className?: string;
  testId?: string;
}

export function HeroBanner({ heroUrl, accent, alt, className, testId = 'org-hero' }: HeroBannerProps) {
  if (!heroUrl) return null;

  return (
    <div
      data-testid={testId}
      className={cn('relative h-48 overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950 shadow-2xl', className)}
      style={{ backgroundColor: accent }}
    >
      <img src={heroUrl} alt={alt} className="h-full w-full object-cover" />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: `linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, ${accent} 100%)` }}
      />
    </div>
  );
}
