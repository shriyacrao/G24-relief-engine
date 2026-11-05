'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, Card, DbTag, Empty, ErrorBox, Loading, PageHead, api } from '@/components/ui';

interface Hit { sos_id: number; urgency_level: string; status: string; description: string; people_count: number; shelter_name: string | null; score: number }
interface Res { q: string; semantic: Hit[] | null; fulltext: Hit[] | null }

const EXAMPLES = [
  'kid burning up with temperature',
  'people stuck on the terrace, water rising',
  'expecting mother needs a doctor',
  'house roof gone, need cover from rain',
  'old people need their tablets',
];

function Results({ hits, kind }: { hits: Hit[] | null; kind: 'semantic' | 'fulltext' }) {
  if (!hits) return null;
  if (!hits.length) return <Empty>{kind === 'fulltext' ? 'No keyword match - none of these words appear in any report.' : 'No results.'}</Empty>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>#</th><th>Report</th><th>Urgency</th><th className="r">{kind === 'semantic' ? 'Cosine' : 'Relevance'}</th></tr></thead>
      <tbody>{hits.map((h) => (
        <tr key={h.sos_id}>
          <td className="num"><Link href={`/sos/${h.sos_id}`}>#{h.sos_id}</Link></td>
          <td><Link href={`/sos/${h.sos_id}`}><span className="clamp">{h.description}</span></Link>
            <div className="small muted">{h.people_count} people · <Badge v={h.status} /></div></td>
          <td><Badge v={h.urgency_level} /></td>
          <td className="r"><span className="score">{Number(h.score).toFixed(3)}</span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function SearchInner() {
  const initial = useSearchParams().get('q') ?? '';
  const [q, setQ] = useState(initial);
  const [status, setStatus] = useState('all');
  const [res, setRes] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(query = q) {
    if (query.trim().length < 2) return;
    setBusy(true); setError(null);
    try { setRes(await api<Res>(`/api/search?q=${encodeURIComponent(query)}&status=${status}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initial) search(initial); }, []);

  return (
    <>
      <PageHead title="Semantic search" sub="Find SOS reports by meaning, and compare with MySQL keyword search on the same query." />
      <Card>
        <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input style={{ flex: 1, minWidth: 260, fontSize: 15, padding: '10px 12px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Describe the situation in your own words…" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option><option value="open">Open only</option>
            <option value="unmatched">Unmatched</option><option value="matched">Matched</option><option value="resolved">Resolved</option>
          </select>
          <button className="btn primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        </form>
        <div className="chips" style={{ marginTop: 10 }}>
          {EXAMPLES.map((e) => <span key={e} className="chip" onClick={() => { setQ(e); search(e); }}>{e}</span>)}
        </div>
      </Card>
      <ErrorBox error={error} />
      {busy && !res && <Loading what="Embedding query" />}
      {res && (
        <div className="grid g2 mt">
          <Card title="By meaning" sub={<>all-MiniLM-L6-v2 embedding → cosine kNN <DbTag>pgvector · search_sos()</DbTag></>} pad={false}>
            <Results hits={res.semantic} kind="semantic" />
          </Card>
          <Card title="By keyword" sub={<>MATCH … AGAINST (natural language) <DbTag>MySQL FULLTEXT</DbTag></>} pad={false}>
            <Results hits={res.fulltext} kind="fulltext" />
          </Card>
        </div>
      )}
      <Card className="mt" title="How it works">
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Every SOS description (plus its needs and disaster type) is turned into a 384-number vector by the all-MiniLM-L6-v2 sentence model, running locally in the Next.js server.</li>
          <li>Vectors are stored in PostgreSQL (pgvector) in a <code>vector(384)</code> column of <code>sos_embeddings</code>, next to status, urgency, location and time columns, with an HNSW index for fast cosine search.</li>
          <li>Your query is embedded the same way; <code>ORDER BY embedding &lt;=&gt; query</code> returns the nearest vectors by cosine distance, optionally filtered by status.</li>
          <li>The matching rows are re-read from MySQL, so status, shelter and urgency are always current.</li>
        </ol>
      </Card>
    </>
  );
}

export default function SearchPage() {
  return <Suspense fallback={<Loading />}><SearchInner /></Suspense>;
}
