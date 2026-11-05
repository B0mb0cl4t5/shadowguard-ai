/** A still placeholder block while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded-md bg-raised ${className}`} />;
}
