interface CostTokenProps {
  credits: number;
  className?: string;
}

export function CostToken({ credits, className = '' }: CostTokenProps) {
  return (
    <span
      data-testid="cost-token"
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 text-black text-xs font-black leading-none ${className}`}
      aria-label={`${credits} credit${credits !== 1 ? 's' : ''}`}
    >
      {credits}
    </span>
  );
}
