'use client';

import { useState } from 'react';
import { Card, DataTable, DbTag, ErrorBox, Loading, PageHead, SqlBlock, useApi } from '@/components/ui';

interface Report { id: string; title: string; concept: string; sql?: string; pipeline?: string; rows: Record<string, unknown>[] }
interface Data { sql: Report[]; mongo: Report[]; mongoError: string | null }

function flatten(rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (k === '_id' && v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, v);
      else if (Array.isArray(v)) out[k] = v.join(', ');
      else if (typeof v === 'number' && !Number.isInteger(v)) out[k] = Math.round(v * 100) / 100;
      else out[k === '_id' ? 'group' : k] = v;
    }
    return out;
  });
}

export default function AnalyticsPage() {
  const { data, error, loading } = useApi<Data>('/api/analytics');
  const [tab, setTab] = useState<'sql' | 'mongo'>('sql');
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const list = tab === 'sql' ? data.sql : data.mongo;

  return (
    <>
      <PageHead title="Analytics" sub="Live reports. Each one shows the exact query or pipeline that produced it.">
        <div className="tabs">
          <button className={tab === 'sql' ? 'on' : ''} onClick={() => setTab('sql')}>MySQL queries</button>
          <button className={tab === 'mongo' ? 'on' : ''} onClick={() => setTab('mongo')}>MongoDB aggregations</button>
        </div>
      </PageHead>
      {tab === 'mongo' && data.mongoError && <div className="notice err" style={{ marginBottom: 16 }}>MongoDB: {data.mongoError}</div>}
      <div className="grid g2">
        {list.map((r) => (
          <Card key={r.id} title={r.title} sub={<DbTag>{r.concept}</DbTag>} pad={false}>
            <DataTable rows={tab === 'mongo' ? flatten(r.rows) : r.rows} />
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
              <SqlBlock code={(r.sql ?? r.pipeline) as string} label={tab === 'sql' ? 'Show SQL' : 'Show pipeline'} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
