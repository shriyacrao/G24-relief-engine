'use client';

import { Badge, Card, DbTag, ErrorBox, Loading, OccBar, PageHead, useApi } from '@/components/ui';

interface Shelter {
  shelter_id: number; name: string; address: string; lat_long: string; capacity: number; current_occupancy: number;
  free_beds: number; occupancy_pct: number; status: string;
  stock: { category: string; units: number; low_lines: number }[];
  nearby: { cases: number; people: number; nearest_m: number | null; top_needs: string[] } | null;
}

export default function SheltersPage() {
  const { data, error, loading } = useApi<Shelter[]>('/api/shelters');
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  return (
    <>
      <PageHead title="Shelters" sub={<>Capacity from <DbTag>v_shelter_directory</DbTag>, stock from <DbTag>v_shelter_item_stock</DbTag>, nearby cases from MongoDB <DbTag>$geoNear</DbTag></>} />
      <div className="grid g2">
        {data.map((s) => (
          <Card key={s.shelter_id} title={s.name} sub={s.address} actions={<Badge v={s.status} />}>
            <div className="stack" style={{ gap: 12 }}>
              <div>
                <div className="row spread small"><span>Occupancy</span><span className="num">{s.current_occupancy} / {s.capacity} · {s.free_beds} free</span></div>
                <OccBar pct={Number(s.occupancy_pct)} />
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 4 }}>Stock on hand by category</div>
                <div className="row" style={{ gap: 4 }}>
                  {s.stock.length === 0 ? <span className="muted small">No stock lines</span> : s.stock.map((c) => (
                    <span key={c.category} className="tag" style={c.low_lines > 0 ? { borderColor: '#f3c3c3', color: 'var(--crit)' } : undefined}>
                      {c.category}: <strong className="num">{c.units}</strong>{c.low_lines > 0 ? ` · ${c.low_lines} low` : ''}
                    </span>
                  ))}
                </div>
              </div>
              <div className="notice info" style={{ padding: '8px 12px' }}>
                {s.nearby
                  ? s.nearby.cases > 0
                    ? <><strong>{s.nearby.cases}</strong> intake cases ({s.nearby.people} people) within 5 km · nearest {Math.round((s.nearby.nearest_m ?? 0) / 100) / 10} km
                      {s.nearby.top_needs.length > 0 && <> · needs: {s.nearby.top_needs.join(', ')}</>}</>
                    : 'No intake cases within 5 km'
                  : 'Nearby-case data unavailable (MongoDB offline)'}
              </div>
              <div className="small muted num">{s.lat_long}</div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
