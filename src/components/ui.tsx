'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/* ------------------------------ data hooks ------------------------------ */

export interface ApiError { error: string; source?: string }

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
    const err = new Error((data as ApiError).error ?? `Request failed (${res.status})`) as Error & { source?: string };
    err.source = (data as ApiError).source;
    throw err;
  }
  return data as T;
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Runs a mutation, shows a toast with the result or the database error */
export function useAction() {
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string; src?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (t: typeof toast) => {
    setToast(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), t?.kind === 'err' ? 9000 : 4500);
  };
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) show({ kind: 'ok', msg: typeof success === 'function' ? success(r) : success });
      return r;
    } catch (e) {
      show({ kind: 'err', msg: (e as Error).message, src: (e as { source?: string }).source });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  const node = toast ? (
    <div className={`notice toast ${toast.kind}`} role="status" onClick={() => setToast(null)}>
      {toast.msg}
      {toast.src && <span className="src">[{toast.src}]</span>}
    </div>
  ) : null;
  return { run, busy, toastNode: node, show };
}

/* ------------------------------ components ------------------------------ */

export function Badge({ v, label }: { v: string | null | undefined; label?: string }) {
  if (!v) return <span className="muted">-</span>;
  return <span className={`badge b-${v}`}>{(label ?? v).replace(/_/g, ' ')}</span>;
}

export function Card({ title, sub, actions, children, pad = true, className = '' }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-h">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={pad ? 'card-b' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ k, v, s, alert }: { k: string; v: ReactNode; s?: ReactNode; alert?: boolean }) {
  return (
    <div className={`card stat ${alert ? 'alert' : ''}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="loading">{what}…</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="notice err">{error}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function OccBar({ pct }: { pct: number }) {
  const cls = pct >= 100 ? 'crit' : pct >= 75 ? 'warn' : '';
  return <div className={`bar ${cls}`}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>;
}

export function DbTag({ children }: { children: ReactNode }) {
  return <span className="dbtag">{children}</span>;
}

export function SqlBlock({ code, label = 'Show query' }: { code: string; label?: string }) {
  return (
    <details className="sql">
      <summary>{label}</summary>
      <pre>{code}</pre>
    </details>
  );
}

export function fmtTime(v: string | Date | null | undefined) {
  if (!v) return '-';
  const d = new Date(v);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function hoursLabel(h: number | null | undefined) {
  if (h == null) return '-';
  if (h < 1) return '<1 h';
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** Generic table for report rows */
export function DataTable({ rows, empty = 'No rows' }: { rows: Record<string, unknown>[]; empty?: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const v = r[c];
                const isNum = typeof v === 'number';
                let shown: ReactNode = v == null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) shown = fmtTime(v);
                return <td key={c} className={isNum ? 'r num' : ''}>{shown}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
