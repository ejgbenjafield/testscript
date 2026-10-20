import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { initials } from '../lib/format';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-cobalt-100 border-t-cobalt-600 ${className}`}
    />
  );
}

export function FullPageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="mt-2 text-ink-muted">{children}</div>
      </div>
    </main>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

export function ErrorNote({ error, className = '' }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className={`rounded-md bg-fail-soft px-3 py-2 text-sm text-fail ${className}`}>
      {message}
    </p>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
      <h3 className="font-semibold">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ name, email, url, size = 28 }: { name?: string | null; email?: string; url?: string | null; size?: number }) {
  if (url) {
    return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full bg-cobalt-100 font-semibold text-cobalt-700"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name, email)}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-ink/40"
    >
      {open && (
        <div className="p-5">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** A button that asks for confirmation in a small dialog before doing something destructive. */
export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  onConfirm,
  className = 'btn-ghost btn-sm',
  children,
}: {
  label: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={label}>
        {children ?? label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn bg-fail text-white hover:bg-fail/90"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </button>
          </>
        }
      >
        <div className="text-sm text-ink-soft">{body}</div>
        <ErrorNote error={error} className="mt-3" />
      </Modal>
    </>
  );
}

/**
 * Text that turns into a field when clicked. Saves on Enter or when focus
 * leaves; Escape cancels.
 */
export function InlineEdit({
  value,
  onSave,
  multiline = false,
  placeholder = 'Add text',
  disabled = false,
  className = '',
  ariaLabel,
}: {
  value: string;
  onSave: (next: string) => Promise<unknown> | void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setDraft(value), [value]);

  if (disabled || !editing) {
    const empty = !value;
    return (
      <span
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? undefined : 0}
        aria-label={disabled ? undefined : `Edit ${ariaLabel}`}
        onClick={() => !disabled && setEditing(true)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={`${disabled ? '' : 'cursor-text rounded hover:bg-cobalt-50'} ${empty ? 'text-ink-faint' : ''} whitespace-pre-wrap ${className}`}
      >
        {value || (disabled ? '' : placeholder)}
      </span>
    );
  }

  const commit = async () => {
    const next = draft.trim();
    if (next === value.trim()) return setEditing(false);
    try {
      await onSave(next);
      setError(null);
      setEditing(false);
    } catch (e) {
      setError(e);
    }
  };
  const props = {
    autoFocus: true,
    value: draft,
    'aria-label': ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft(value);
        setEditing(false);
      }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void commit();
      }
    },
    className: `field ${className}`,
  };
  return (
    <span className="block">
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      {error ? <ErrorNote error={error} className="mt-1" /> : null}
    </span>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            value === t.id ? 'border-cobalt-600 text-ink' : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Toasts -----------------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}
const useToasts = create<{ toasts: Toast[]; push: (m: string, tone?: Toast['tone']) => void; dismiss: (id: number) => void }>(
  (set) => ({
    toasts: [],
    push: (message, tone = 'info') => {
      const id = Date.now() + Math.random();
      set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6000 : 3500);
    },
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }),
);

export const toast = {
  info: (m: string) => useToasts.getState().push(m, 'info'),
  error: (m: string) => useToasts.getState().push(m, 'error'),
};

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-sm rounded-md px-4 py-2.5 text-left text-sm shadow-lg ${
            t.tone === 'error' ? 'bg-fail text-white' : 'bg-ink text-white'
          }`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
