import { useState, useEffect } from 'react';
import type { QueueView } from '../api';
import { CoverCard } from './CoverCard';

interface CoverFlowProps {
  queueView: QueueView;
}

const MAX_SIDE = 5;
// On narrow screens show fewer side items to avoid overflow
const MOBILE_MAX_SIDE = 2;

export function CoverFlow({ queueView }: CoverFlowProps) {
  const [animate, setAnimate] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Enable CSS transitions after first render (prevents cards from "flying in" on mount)
  useEffect(() => {
    const id = setTimeout(() => setAnimate(true), 120);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const { nowPlaying, previous, upcoming } = queueView;
  const sideCount = isMobile ? MOBILE_MAX_SIDE : MAX_SIDE;

  // previous[0] is most-recently-played → index -1 (closest to center on the left)
  const leftItems = previous.slice(0, sideCount);
  // upcoming[0] is next to play → index +1 (closest to center on the right)
  const rightItems = upcoming.slice(0, sideCount);

  return (
    <div className="w-full select-none">
      {/* Stage — perspective set here for shared vanishing point */}
      <div
        className="relative w-full overflow-hidden"
        style={{ height: isMobile ? '200px' : '280px', perspective: '1200px' }}
      >
        {/* Edge fade gradient — masks items at the viewport edges */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 60,
            background: 'linear-gradient(to right, #0a0a0a 0%, transparent 16%, transparent 84%, #0a0a0a 100%)',
          }}
        />

        {/* Previous items — left side, index -1, -2, ... */}
        {leftItems.map((item, i) => (
          <CoverCard
            key={item.id}
            item={item}
            index={-(i + 1)}
            animate={animate}
          />
        ))}

        {/* Now playing — center, index 0 */}
        {nowPlaying ? (
          <CoverCard
            key={nowPlaying.id}
            item={nowPlaying}
            index={0}
            animate={animate}
          />
        ) : (
          <div
            className="absolute rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center"
            style={{
              left: '50%',
              top: '50%',
              width: '160px',
              height: '200px',
              transform: 'translateX(-50%) translateY(-50%)',
              zIndex: 50,
            }}
          >
            <span className="text-zinc-600 text-xs text-center px-4">Nothing playing yet</span>
          </div>
        )}

        {/* Upcoming items — right side, index +1, +2, ... */}
        {rightItems.map((item, i) => (
          <CoverCard
            key={item.id}
            item={item}
            index={i + 1}
            animate={animate}
          />
        ))}
      </div>

      {/* Now playing info strip */}
      {nowPlaying && (
        <div className="mt-5 text-center px-6">
          <div className="inline-flex items-center gap-1.5 text-xs text-green-400 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Now Playing
          </div>
          <p className="text-white text-2xl font-black truncate leading-tight">
            {nowPlaying.track.title}
          </p>
          <p className="text-zinc-400 text-sm mt-0.5 truncate">
            {nowPlaying.track.artist}
            <span className="text-zinc-600"> · </span>
            {nowPlaying.track.album}
          </p>
        </div>
      )}
    </div>
  );
}
