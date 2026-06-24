import { useEffect } from 'react';

export interface ToastState {
  id: number;
  msg: string;
  type: 'success' | 'error';
}

interface ToastProps {
  toast: ToastState;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 3500);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] w-max max-w-[calc(100vw-2rem)] pointer-events-none"
    >
      <div
        className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-medium ${
          toast.type === 'success'
            ? 'bg-zinc-900 border-green-700/60 text-white'
            : 'bg-zinc-900 border-red-700/60 text-white'
        }`}
      >
        {toast.type === 'success' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400 flex-shrink-0">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 flex-shrink-0">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
          </svg>
        )}
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}
