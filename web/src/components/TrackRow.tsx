import type { Track, QueueView } from '../api';

interface TrackRowProps {
  track: Track;
  queueView: QueueView;
  creditBalance: number;
  onAction: (track: Track, tier: 'queue' | 'boost' | 'play_next') => void;
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TrackRow({ track, queueView, creditBalance, onAction }: TrackRowProps) {
  const { pricing, playNext } = queueView;

  const playNextUnavailable = playNext.status !== 'available';
  const playNextLabel =
    playNext.status === 'locked'
      ? 'Slot taken'
      : playNext.status === 'cooldown'
      ? 'Cooling down'
      : null;

  return (
    <div className="flex items-center gap-3 bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-3 transition-all group">
      {/* Artwork */}
      <img
        src={track.artworkUrl}
        alt={track.title}
        className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
      />

      {/* Track info */}
      <div className="min-w-0 flex-1">
        <p className="text-white font-semibold text-sm truncate">{track.title}</p>
        <p className="text-zinc-400 text-xs truncate mt-0.5">{track.artist}</p>
        <p className="text-zinc-600 text-xs truncate">{track.album}</p>
      </div>

      {/* Duration */}
      <span className="text-zinc-600 text-xs flex-shrink-0 hidden sm:block">
        {formatMs(track.durationMs)}
      </span>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0">
        {/* Add to Queue — always free */}
        <button
          onClick={() => onAction(track, 'queue')}
          aria-label={`Add ${track.title} to queue (free)`}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap border border-zinc-700 hover:border-zinc-600"
        >
          {pricing.queue === 0 ? 'Add free' : `Add (${pricing.queue}cr)`}
        </button>

        {/* Boost */}
        <button
          onClick={() => onAction(track, 'boost')}
          aria-label={`Boost ${track.title} to top of queue (${pricing.boost} credit${pricing.boost !== 1 ? 's' : ''})`}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap border ${
            creditBalance >= pricing.boost
              ? 'bg-violet-900/70 hover:bg-violet-800 text-violet-200 border-violet-700 hover:border-violet-600'
              : 'bg-zinc-800/50 text-zinc-500 border-zinc-800 cursor-pointer'
          }`}
        >
          Boost {pricing.boost}cr
        </button>

        {/* Play Next */}
        <button
          onClick={() => onAction(track, 'play_next')}
          disabled={playNextUnavailable}
          aria-label={
            playNextUnavailable
              ? `Play Next unavailable: ${playNextLabel ?? playNext.status}`
              : `Play Next: ${track.title} (${pricing.playNext} credits)`
          }
          title={playNextUnavailable ? (playNextLabel ?? playNext.status) : undefined}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap border ${
            playNextUnavailable
              ? 'bg-zinc-800/30 text-zinc-600 border-zinc-800 cursor-not-allowed'
              : creditBalance >= pricing.playNext
              ? 'bg-yellow-900/70 hover:bg-yellow-800 text-yellow-200 border-yellow-700 hover:border-yellow-600'
              : 'bg-zinc-800/50 text-zinc-500 border-zinc-800 cursor-pointer'
          }`}
        >
          {playNextUnavailable ? (playNextLabel ?? 'Unavailable') : `Next ${pricing.playNext}cr`}
        </button>
      </div>
    </div>
  );
}
