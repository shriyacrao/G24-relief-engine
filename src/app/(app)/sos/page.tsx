'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, DbTag, Empty, ErrorBox, Loading, PageHead, api, fmtTime, hoursLabel, useAction, useApi } from '@/components/ui';
import { useIsCoordinator, useUser } from '@/components/UserContext';

interface SosRow {
  sos_id: number; urgency_level: string; status: string; description: string; people_count: number;
  reported_at: string; hours_waiting: number; shelter_name: string | null; reporter_name?: string; reported_by: number;
}

const STATUS_TABS = ['open', 'unmatched', 'matched', 'resolved', 'all'];

export default function SosListPage() {
  const isCoord = useIsCoordinator();
  const user = useUser();
  const [status, setStatus] = useState('open');
  const [urgency, setUrgency] = useState('all');
  const [mine, setMine] = useState(false);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const url = `/api/sos?status=${status}&urgency=${urgency}${mine ? '&mine=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { data, error, loading, reload } = useApi<SosRow[]>(url);
  const { run, busy, toastNode } = useAction();

  async function autoMatch() {
    const r = await run(() => api<{ matched: number; failed: number }>('/api/sos/auto-match', { method: 'POST' }),
      (r) => `sp_auto_match_unmatched: ${r.matched} matched, ${r.failed} could not be placed`);
    if (r) reload();
  }
  async function escalate() {
    const r = await run(() => api<{ escalated: number }>('/api/sos/escalate', { body: { hours: 12 } }),
      (r) => `${r.escalated} unmatched SOS waiting 12h+ moved up one urgency level`);
    if (r) reload();
  }

  return (
    <>
      <PageHead title="SOS reports" sub="Every distress report filed by the field team">
        {isCoord && <>
          <button className="btn" disabled={busy} onClick={escalate} title="UPDATE ... CASE: unmatched & waiting 12h+">Escalate stale</button>
          <button className="btn dark" disabled={busy} onClick={autoMatch} title="CALL sp_auto_match_unmatched (cursor)">Auto-match all</button>
        </>}
        <Link className="btn primary" href="/sos/new">+ New SOS</Link>
      </PageHead>

      <Card pad={false}
        title={<div className="tabs">{STATUS_TABS.map((s) => (
          <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)} style={{ textTransform: 'capitalize' }}>{s}</button>
        ))}</div>}
        actions={<>
          <form className="row" onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); }}>
            <input placeholder="Keyword search (FULLTEXT)" value={qInput} onChange={(e) => setQInput(e.target.value)} style={{ width: 220 }} />
            {q && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setQInput(''); }}>Clear</button>}
          </form>
          <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            <option value="all">All urgencies</option>
            {['critical', 'high', 'medium', 'low'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine</label>
        </>}>
        {q && <div className="notice info" style={{ margin: 12 }}>
          Keyword results for “{q}” via <code>MATCH(description) AGAINST(...)</code>. For meaning-based search try <Link href={`/search?q=${encodeURIComponent(q)}`} style={{ textDecoration: 'underline' }}>Semantic search</Link>.
        </div>}
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty>No SOS reports match these filters.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr>
              <th>#</th><th>Urgency</th><th>Status</th><th>Report</th><th className="r">People</th>
              <th>Reported</th><th>Waiting</th><th>Shelter</th>{isCoord && <th>By</th>}
            </tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.sos_id}>
                  <td className="num"><Link href={`/sos/${s.sos_id}`}>#{s.sos_id}</Link></td>
                  <td><Badge v={s.urgency_level} /></td>
                  <td><Badge v={s.status} /></td>
                  <td><Link href={`/sos/${s.sos_id}`}><span className="clamp">{s.description}</span></Link></td>
                  <td className="r num">{s.people_count}</td>
                  <td className="small">{fmtTime(s.reported_at)}</td>
                  <td className="num">{s.status === 'resolved' ? '-' : hoursLabel(s.hours_waiting)}</td>
                  <td>{s.shelter_name ?? <span className="muted">-</span>}</td>
                  {isCoord && <td className="small">{s.reported_by === user.uid ? 'You' : s.reporter_name}</td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      <p className="small muted">Ordered by <DbTag>fn_urgency_rank()</DbTag> then oldest first · data from <DbTag>VICTIM_SOS</DbTag> ⋈ <DbTag>v_shelter_directory</DbTag></p>
      {toastNode}
    </>
  );
}
