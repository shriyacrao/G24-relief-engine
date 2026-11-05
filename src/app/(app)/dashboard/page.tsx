'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Badge, Card, DbTag, Empty, ErrorBox, Loading, OccBar, PageHead, Stat, hoursLabel, useApi } from '@/components/ui';
import { useUser } from '@/components/UserContext';

interface Dash {
  shelters: { shelter_id: number; name: string; capacity: number; current_occupancy: number; free_beds: number; occupancy_pct: number; status: string }[];
  openSos: { sos_id: number; urgency_level: string; status: string; people_count: number; description: string; hours_waiting: number; matched_shelter: string | null }[];
  lowStock: { stock_id: number; shelter: string; item_name: string; quantity_available: number; reorder_threshold: number; shortfall: number; unit: string }[];
  urgencyMix: { urgency_level: string; status: string; n: number; people: number }[];
  mine: { reported: number; resolved: number | null; people: number };
  coord: null | { kpi: Record<string, number>[]; attention: { alert_type: string; detail: string }[] };
  topNeeds: { _id: string; cases: number; people: number }[];
}

function DashboardInner() {
  const user = useUser();
  const denied = useSearchParams().get('denied');
  const { data, error, loading } = useApi<Dash>('/api/dashboard');
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;

  const open = data.urgencyMix.reduce((a, r) => a + Number(r.n), 0);
  const people = data.urgencyMix.reduce((a, r) => a + Number(r.people), 0);
  const unmatched = data.urgencyMix.filter((r) => r.status === 'unmatched').reduce((a, r) => a + Number(r.n), 0);
  const critical = data.urgencyMix.filter((r) => r.urgency_level === 'critical').reduce((a, r) => a + Number(r.n), 0);
  const freeBeds = data.shelters.filter((s) => s.status === 'active').reduce((a, s) => a + s.free_beds, 0);
  const kpi = data.coord?.kpi[0];
  const maxNeed = Math.max(1, ...data.topNeeds.map((n) => n.cases));

  return (
    <>
      <PageHead title={`Good to see you, ${user.name.split(' ')[0]}`} sub={user.role === 'Relief Coordinator' ? 'Operations overview across all shelters' : 'Field overview - file SOS reports and find shelter beds'}>
        <Link className="btn primary" href="/sos/new">+ New SOS</Link>
      </PageHead>
      {denied && <div className="notice warn" style={{ marginBottom: 16 }}>That page is for Relief Coordinators only.</div>}

      <div className="grid g5">
        <Stat k="Open SOS" v={open} s={`${people} people affected`} />
        <Stat k="Critical" v={critical} s="open critical reports" alert={critical > 0} />
        <Stat k="Awaiting shelter" v={unmatched} s="unmatched SOS" alert={unmatched > 0} />
        <Stat k="Free beds" v={freeBeds} s="across active shelters" />
        {kpi ? (
          <Stat k="On the road" v={kpi.on_the_road} s={`${kpi.vehicles_available} vehicles free · ${kpi.pending_reservations} pending`} />
        ) : (
          <Stat k="My reports" v={data.mine.reported} s={`${data.mine.people} people · ${data.mine.resolved ?? 0} resolved`} />
        )}
      </div>

      <div className="grid g3 mt">
        <Card className="span2" title="Priority queue" sub={<>Open SOS ranked by urgency, then waiting time <DbTag>v_open_sos_priority</DbTag></>} pad={false}
          actions={<Link className="btn sm" href="/sos">All reports</Link>}>
          {data.openSos.length === 0 ? <Empty>No open SOS reports.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>#</th><th>Urgency</th><th>Report</th><th className="r">People</th><th>Waiting</th><th>Shelter</th></tr></thead>
              <tbody>
                {data.openSos.map((s) => (
                  <tr key={s.sos_id}>
                    <td className="num"><Link href={`/sos/${s.sos_id}`}>#{s.sos_id}</Link></td>
                    <td><Badge v={s.urgency_level} /></td>
                    <td><Link href={`/sos/${s.sos_id}`}><span className="clamp">{s.description}</span></Link></td>
                    <td className="r num">{s.people_count}</td>
                    <td className="num">{hoursLabel(s.hours_waiting)}</td>
                    <td>{s.matched_shelter ?? <Badge v="unmatched" />}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>

        <Card title="Most requested needs" sub={<>From intake forms <DbTag>MongoDB $unwind/$group</DbTag></>}>
          {data.topNeeds.length === 0 ? <Empty>No intake data yet.</Empty> : (
            <div className="stack" style={{ gap: 10 }}>
              {data.topNeeds.map((n) => (
                <div key={n._id}>
                  <div className="row spread small"><span style={{ textTransform: 'capitalize' }}>{n._id}</span><span className="num">{n.cases} cases</span></div>
                  <div className="bar"><span style={{ width: `${(n.cases / maxNeed) * 100}%`, background: 'var(--ink-2)' }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card title="Shelter occupancy" sub={<><DbTag>v_shelter_directory</DbTag> status kept in sync by triggers</>} pad={false}
          actions={<Link className="btn sm" href="/shelters">Shelters</Link>}>
          <div className="table-wrap"><table>
            <thead><tr><th>Shelter</th><th>Status</th><th style={{ width: '30%' }}>Occupancy</th><th className="r">Free</th></tr></thead>
            <tbody>
              {data.shelters.map((s) => (
                <tr key={s.shelter_id}>
                  <td>{s.name}</td>
                  <td><Badge v={s.status} /></td>
                  <td><OccBar pct={Number(s.occupancy_pct)} /><span className="small muted num">{s.current_occupancy}/{s.capacity} · {s.occupancy_pct}%</span></td>
                  <td className="r num">{s.free_beds}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>

        <Card title="Low stock" sub={<>At or below reorder threshold <DbTag>v_low_stock</DbTag></>} pad={false}
          actions={user.role === 'Relief Coordinator' ? <Link className="btn sm" href="/inventory?health=LOW">Inventory</Link> : null}>
          {data.lowStock.length === 0 ? <Empty>All stock lines are above threshold.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Shelter</th><th>Item</th><th className="r">Left</th><th className="r">Threshold</th></tr></thead>
              <tbody>
                {data.lowStock.map((s) => (
                  <tr key={s.stock_id}>
                    <td>{s.shelter}</td><td>{s.item_name}</td>
                    <td className="r num" style={{ color: 'var(--crit)', fontWeight: 600 }}>{s.quantity_available} {s.unit}</td>
                    <td className="r num">{s.reorder_threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>

      {data.coord && data.coord.attention.length > 0 && (
        <Card className="mt" title="Needs attention" sub={<>One feed from three tables <DbTag>UNION ALL</DbTag></>}>
          <div className="chips">
            {data.coord.attention.map((a, i) => (
              <span key={i} className="tag"><strong>{a.alert_type}</strong> · {a.detail}</span>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={<Loading />}><DashboardInner /></Suspense>;
}
