'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, DbTag, Empty, ErrorBox, Loading, PageHead, api, fmtTime, useAction, useApi } from '@/components/ui';

interface Open { reservation_id: number; sos_id: number; urgency_level: string; item_name: string; unit: string; shelter_name: string; quantity_reserved: number; quantity_dispatched: number; remaining: number; status: string; created_at: string }
interface Log { log_id: number; sos_id: number; item_name: string; quantity_dispatched: number; unit: string; from_shelter: string; vehicle: string | null; vehicle_type: string | null; approved_by_name: string; dispatch_status: string; dispatch_time: string }
interface Vehicle { vehicle_id: number; registration_no: string; type: string; status: string; capacity_kg: number; trips: number; units_moved: number }
interface Board { open: Open[]; active: Log[]; recent: Log[]; vehicles: Vehicle[] }

export default function DispatchPage() {
  const { data, error, loading, reload } = useApi<Board>('/api/dispatch');
  const { run, busy, toastNode } = useAction();
  const [pick, setPick] = useState<Record<number, { vehicle: string; qty: string }>>({});
  const [nv, setNv] = useState({ registration_no: '', type: 'Truck', capacity_kg: '' });

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const available = data.vehicles.filter((v) => v.status === 'available');
  const act = async (fn: () => Promise<unknown>, msg: string) => { if (await run(fn, msg)) reload(); };

  return (
    <>
      <PageHead title="Dispatch" sub="Approve reserved supplies onto vehicles and close deliveries. Every step is validated by triggers." />

      <Card pad={false} title="Ready to dispatch" sub={<>Open reservations with quantity left <DbTag>v_reservation_detail</DbTag></>}>
        {data.open.length === 0 ? <Empty>Nothing waiting. Reserve supplies from an SOS page.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Res.</th><th>SOS</th><th>Item</th><th>From</th><th className="r">Left</th><th>Status</th><th>Vehicle</th><th>Qty</th><th /></tr></thead>
            <tbody>{data.open.map((r) => {
              const p = pick[r.reservation_id] ?? { vehicle: available[0] ? String(available[0].vehicle_id) : '', qty: String(r.remaining) };
              const set = (patch: Partial<typeof p>) => setPick((x) => ({ ...x, [r.reservation_id]: { ...p, ...patch } }));
              return (
                <tr key={r.reservation_id}>
                  <td className="num">#{r.reservation_id}</td>
                  <td><Link href={`/sos/${r.sos_id}`} className="num">#{r.sos_id}</Link> <Badge v={r.urgency_level} /></td>
                  <td>{r.item_name}</td><td>{r.shelter_name}</td>
                  <td className="r num">{r.remaining} {r.unit}</td><td><Badge v={r.status} /></td>
                  <td><select value={p.vehicle} onChange={(e) => set({ vehicle: e.target.value })}>
                    <option value="">No vehicle (pickup)</option>
                    {data.vehicles.map((v) => <option key={v.vehicle_id} value={v.vehicle_id} disabled={v.status !== 'available'}>{v.registration_no} · {v.type}{v.status !== 'available' ? ` (${v.status})` : ''}</option>)}
                  </select></td>
                  <td><input type="number" min={1} value={p.qty} onChange={(e) => set({ qty: e.target.value })} style={{ width: 70 }} /></td>
                  <td><button className="btn primary sm" disabled={busy} onClick={() => act(() => api('/api/dispatch', {
                    body: { reservation_id: r.reservation_id, vehicle_id: p.vehicle ? Number(p.vehicle) : null, quantity: Number(p.qty) },
                  }), 'Dispatch approved - vehicle now in transit')}>Approve</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>

      <div className="grid g2 mt">
        <Card pad={false} title="On the road" sub={<DbTag>v_dispatch_overview</DbTag>}>
          {data.active.length === 0 ? <Empty>No active dispatches.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Log</th><th>Load</th><th>Vehicle</th><th>Since</th><th /></tr></thead>
              <tbody>{data.active.map((d) => (
                <tr key={d.log_id}>
                  <td className="num">#{d.log_id}<div className="small"><Link href={`/sos/${d.sos_id}`}>SOS #{d.sos_id}</Link></div></td>
                  <td>{d.quantity_dispatched} {d.unit} {d.item_name}<div className="small muted">from {d.from_shelter} · by {d.approved_by_name}</div></td>
                  <td>{d.vehicle ?? 'pickup'}</td>
                  <td className="small">{fmtTime(d.dispatch_time)}</td>
                  <td className="row" style={{ gap: 4 }}>
                    <button className="btn sm dark" disabled={busy} onClick={() => act(() => api(`/api/dispatch/${d.log_id}/deliver`, { method: 'POST' }), 'Delivered - vehicle freed, reservation fulfilled when complete')}>Delivered</button>
                    <button className="btn sm ghost danger" disabled={busy} onClick={() => act(() => api(`/api/dispatch/${d.log_id}/cancel`, { method: 'POST' }), 'Dispatch cancelled')}>Cancel</button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        <Card pad={false} title="Fleet" sub="Status changes are written by dispatch triggers">
          <div className="table-wrap"><table>
            <thead><tr><th>Vehicle</th><th>Status</th><th className="r">Trips</th><th className="r">Units</th><th /></tr></thead>
            <tbody>{data.vehicles.map((v) => (
              <tr key={v.vehicle_id}>
                <td><span className="num">{v.registration_no}</span><div className="small muted">{v.type} · {v.capacity_kg} kg</div></td>
                <td><Badge v={v.status} /></td>
                <td className="r num">{v.trips}</td><td className="r num">{v.units_moved}</td>
                <td>{v.status === 'available'
                  ? <button className="btn sm ghost" disabled={busy} onClick={() => act(() => api(`/api/vehicles/${v.vehicle_id}`, { method: 'PATCH', body: { status: 'maintenance' } }), 'Sent to maintenance')}>Maintenance</button>
                  : <button className="btn sm ghost" disabled={busy} onClick={() => act(() => api(`/api/vehicles/${v.vehicle_id}`, { method: 'PATCH', body: { status: 'available' } }), 'Vehicle available')}>Set available</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
            <form className="row" style={{ gap: 6 }} onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api('/api/vehicles', { body: { ...nv, capacity_kg: Number(nv.capacity_kg) } }), 'Vehicle added')) { setNv({ registration_no: '', type: 'Truck', capacity_kg: '' }); reload(); }
          }}>
            <input required placeholder="KA-01-XY-1234" value={nv.registration_no} onChange={(e) => setNv({ ...nv, registration_no: e.target.value })} style={{ width: 130, padding: '5px 8px' }} />
            <select value={nv.type} onChange={(e) => setNv({ ...nv, type: e.target.value })} style={{ padding: '5px 8px' }}>
              {['Truck', 'Mini Truck', 'Tempo', 'Ambulance', 'Boat'].map((t) => <option key={t}>{t}</option>)}
            </select>
            <input required type="number" min={1} placeholder="kg" value={nv.capacity_kg} onChange={(e) => setNv({ ...nv, capacity_kg: e.target.value })} style={{ width: 70, padding: '5px 8px' }} />
            <button className="btn sm" disabled={busy}>Add vehicle</button>
          </form>
          </div>
        </Card>
      </div>

      <Card className="mt" pad={false} title="Recently closed">
        {data.recent.length === 0 ? <Empty>No closed dispatches yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Log</th><th>SOS</th><th>Load</th><th>Vehicle</th><th>Approved by</th><th>Time</th><th>Status</th></tr></thead>
            <tbody>{data.recent.map((d) => (
              <tr key={d.log_id}>
                <td className="num">#{d.log_id}</td><td><Link href={`/sos/${d.sos_id}`}>#{d.sos_id}</Link></td>
                <td>{d.quantity_dispatched} {d.unit} {d.item_name}</td><td>{d.vehicle ?? '-'}</td><td>{d.approved_by_name}</td>
                <td className="small">{fmtTime(d.dispatch_time)}</td><td><Badge v={d.dispatch_status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {toastNode}
    </>
  );
}
