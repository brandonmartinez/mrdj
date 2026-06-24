import React from 'react';
import type { QueueItem } from '../api';

interface CoverCardProps {
  item: QueueItem;
  index: number; // negative = previous (left), 0 = now-playing, positive = upcoming (right)
  animate: boolean;
}

const CARD_W = 160;
const CARD_H = 200;
const SPACING = 120; // px between card centers on the flat plane
const SIDE_ROT = 52; // degrees — constant rotation for all side items (classic Cover Flow)

function getStyle(index: number, animate: boolean): React.CSSProperties {
  const a = Math.abs(index);
  const isCenter = index === 0;

  // Center is largest; each step out reduces scale
  const scale = isCenter ? 1.15 : Math.max(0.38, 0.78 - (a - 1) * 0.11);
  const opacity = isCenter ? 1.0 : Math.max(0.08, 0.72 - (a - 1) * 0.22);
  // All side items share the same tilt angle (classic macOS Cover Flow look)
  const rotY = isCenter ? 0 : index < 0 ? SIDE_ROT : -SIDE_ROT;
  const tx = index * SPACING;
  const zIndex = 50 - a;

  return {
    position: 'absolute' as const,
    left: '50%',
    top: '50%',
    width: `${CARD_W}px`,
    height: `${CARD_H}px`,
    transform: `translateX(calc(-50% + ${tx}px)) translateY(-50%) rotateY(${rotY}deg) scale(${scale})`,
    opacity,
    zIndex,
    transition: animate
      ? 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.6s ease'
      : 'none',
    willChange: 'transform, opacity',
    borderRadius: '10px',
    overflow: 'hidden',
    boxShadow: isCenter
      ? '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)'
      : '0 8px 24px rgba(0,0,0,0.5)',
  };
}

export function CoverCard({ item, index, animate }: CoverCardProps) {
  const style = getStyle(index, animate);
  const isCenter = index === 0;

  return (
    <div className="cover-card" style={style}>
      <img
        src={item.track.artworkUrl}
        alt={isCenter ? `${item.track.title} by ${item.track.artist}` : item.track.title}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        draggable={false}
      />

      {/* Play Next badge */}
      {item.isPlayNext && (
        <div
          className="absolute top-2 right-2 bg-yellow-500 text-black text-xs font-black px-2 py-0.5 rounded-full"
          style={{ zIndex: 10 }}
        >
          NEXT
        </div>
      )}

      {/* Reflection */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '50%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
