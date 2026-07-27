import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-500/40",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-sunken",
  ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  danger: "bg-bad text-white hover:brightness-95",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(({ className, variant = "secondary", size = "md", loading, children, disabled, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center rounded-md font-medium transition-colors",
      "disabled:cursor-not-allowed disabled:opacity-60",
      VARIANTS[variant], SIZES[size], className,
    )}
    {...props}
  >
    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    {children}
  </button>
));
Button.displayName = "Button";

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm",
        "placeholder:text-ink-faint focus:border-brand-500", className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9 rounded-md border border-line bg-surface px-2.5 text-sm text-ink",
        "focus:border-brand-500", className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title, description, action,
}: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-faint">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
export function Badge({
  tone = "neutral", children,
}: { tone?: "neutral" | "good" | "bad" | "warn" | "brand"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-sunken text-ink-muted",
    good: "bg-good-soft text-good",
    bad: "bg-bad-soft text-bad",
    warn: "bg-warn-soft text-warn",
    brand: "bg-brand-50 text-brand-700",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium", tones[tone],
    )}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 상태 화면
// ---------------------------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-line/70", className)} />;
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={cn("h-5 flex-1", j === 0 && "flex-[2]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title, description, action,
}: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Inbox className="h-8 w-8 text-ink-faint" strokeWidth={1.5} />
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink-faint">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-bad" strokeWidth={1.5} />
      <p className="text-sm font-medium text-ink">데이터를 불러오지 못했습니다</p>
      <p className="max-w-md break-words text-xs text-ink-faint">{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>다시 시도</Button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({
  open, onClose, title, children, footer, width = "max-w-lg",
}: {
  open: boolean; onClose: () => void; title: string;
  children: ReactNode; footer?: ReactNode; width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
      <div className={cn("w-full rounded-lg bg-surface shadow-xl", width)}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-surface-sunken">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
export function Pagination({
  page, pageSize, total, onChange,
}: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-muted">
      <span className="tnum">
        {total.toLocaleString("ko-KR")}건 중 {(page * pageSize + 1).toLocaleString("ko-KR")}–
        {Math.min((page + 1) * pageSize, total).toLocaleString("ko-KR")}
      </span>
      <div className="flex items-center gap-1.5">
        <Button size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>이전</Button>
        <span className="tnum px-1">{page + 1} / {pages}</span>
        <Button size="sm" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>다음</Button>
      </div>
    </div>
  );
}
