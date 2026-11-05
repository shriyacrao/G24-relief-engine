'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, Card, DbTag, Empty, ErrorBox, Loading, PageHead, api, fmtTime, useAction, useApi } from '@/components/ui';

interface Line {
  stock_id: number; shelter_id: number; shelter_name: string; item_id: number; item_name: string; category: string; unit: string;
  quantity_available: number; reorder_threshold: number; last_updated: string; health: string;
}
interface Alert { alert_id: number; shelter_name: string; item_name: string; unit: string; quantity_at_alert: number; reorder_threshold: number; quantity_now: number; alert_time: string; is_resolved: number }
interface Item { item_id: number; item_name: string; category: string; unit: string }
interface ShelterLite { shelter_id: number; name: string }

function InventoryInner() {
  const initialHealth = useSearchParams().get('health') ?? 'all';
  const [shelter, setShelter] = useState('');
  const [category, setCategory] = useState('all');
  const [health, setHealth] = useState(initialHealth);
  const stock = useApi<Line[]>(`/api/inventory?health=${health}&category=${category}${shelter ? `&shelter=${shelter}` : ''}`);
  const alerts = useApi<Alert[]>('/api/inventory/alerts');
  const items = useApi<Item[]>('/api/items');
  const shelters = useApi<ShelterLite[]>('/api/shelters');
  const { run, busy, toastNode } = useAction();

  const [rs, setRs] = useState({ item_id: '', shelter_id: '', quantity: '' });
  const [tr, setTr] = useState({ item_id: '', from_shelter: '', to_shelter: '', quantity: '' });
  const [ni, setNi] = useState({ item_name: '', category: '', unit: '', usage_notes: '' });

  const categories = useMemo(() => Array.from(new Set((items.data ?? []).map((i) => i.category))).sort(), [items.data]);
  const refresh = () => { stock.reload(); alerts.reload(); };
  const num = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));

  return (
    <>
      <PageHead title="Inventory" sub={<>Stock per shelter <DbTag>v_shelter_item_stock</DbTag> · low-stock alerts are raised by <DbTag>trg_stock_au</DbTag></>} />

      <div className="grid g3">
        <Card title="Restock" sub={<DbTag>CALL sp_restock</DbTag>}>
          <form className="stack" style={{ gap: 10 }} onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api('/api/inventory/restock', { body: num(rs) }), 'Restocked - alert auto-resolves once above threshold')) refresh();
          }}>
            <select required value={rs.item_id} onChange={(e) => setRs({ ...rs, item_id: e.target.value })}>
              <option value="">Item…</option>{items.data?.map((i) => <option key={i.item_id} value={i.item_id}>{i.item_name} ({i.unit})</option>)}
            </select>
            <select required value={rs.shelter_id} onChange={(e) => setRs({ ...rs, shelter_id: e.target.value })}>
              <option value="">Shelter…</option>{shelters.data?.map((s) => <option key={s.shelter_id} value={s.shelter_id}>{s.name}</option>)}
            </select>
            <input type="number" min={1} required placeholder="Quantity" value={rs.quantity} onChange={(e) => setRs({ ...rs, quantity: e.target.value })} />
            <button className="btn dark" disabled={busy}>Add stock</button>
          </form>
        </Card>
        <Card title="Transfer between shelters" sub={<><DbTag>CALL sp_transfer_stock</DbTag> one atomic transaction</>}>
          <form className="stack" style={{ gap: 10 }} onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api('/api/inventory/transfer', { body: num(tr) }), 'Transfer committed')) refresh();
          }}>
            <select required value={tr.item_id} onChange={(e) => setTr({ ...tr, item_id: e.target.value })}>
              <option value="">Item…</option>{items.data?.map((i) => <option key={i.item_id} value={i.item_id}>{i.item_name}</option>)}
            </select>
            <div className="grid g2" style={{ gap: 8 }}>
              <select required value={tr.from_shelter} onChange={(e) => setTr({ ...tr, from_shelter: e.target.value })}>
                <option value="">From…</option>{shelters.data?.map((s) => <option key={s.shelter_id} value={s.shelter_id}>{s.name}</option>)}
              </select>
              <select required value={tr.to_shelter} onChange={(e) => setTr({ ...tr, to_shelter: e.target.value })}>
                <option value="">To…</option>{shelters.data?.map((s) => <option key={s.shelter_id} value={s.shelter_id}>{s.name}</option>)}
              </select>
            </div>
            <input type="number" min={1} required placeholder="Quantity" value={tr.quantity} onChange={(e) => setTr({ ...tr, quantity: e.target.value })} />
            <button className="btn dark" disabled={busy}>Transfer</button>
          </form>
        </Card>
        <Card title="New catalogue item" sub={<>MySQL row + embedding <DbTag>pgvector · item_embeddings</DbTag></>}>
          <form className="stack" style={{ gap: 10 }} onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api<{ item_id: number }>('/api/items', { body: ni }), (r) => `Item #${r.item_id} added and embedded`)) {
              setNi({ item_name: '', category: '', unit: '', usage_notes: '' }); items.reload();
            }
          }}>
            <input required placeholder="Item name (e.g. ORS Sachets)" value={ni.item_name} onChange={(e) => setNi({ ...ni, item_name: e.target.value })} />
            <div className="grid g2" style={{ gap: 8 }}>
              <input required placeholder="Category" list="cats" value={ni.category} onChange={(e) => setNi({ ...ni, category: e.target.value })} />
              <input required placeholder="Unit" value={ni.unit} onChange={(e) => setNi({ ...ni, unit: e.target.value })} />
            </div>
            <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <input required placeholder="When is it needed? (used for matching)" value={ni.usage_notes} onChange={(e) => setNi({ ...ni, usage_notes: e.target.value })} />
            <button className="btn dark" disabled={busy}>Add item</button>
          </form>
        </Card>
      </div>

      <Card className="mt" pad={false} title="Stock lines"
        actions={<>
          <select value={shelter} onChange={(e) => setShelter(e.target.value)}>
            <option value="">All shelters</option>{shelters.data?.map((s) => <option key={s.shelter_id} value={s.shelter_id}>{s.name}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={health} onChange={(e) => setHealth(e.target.value)}>
            <option value="all">Any health</option>{['OUT', 'LOW', 'WATCH', 'OK'].map((h) => <option key={h}>{h}</option>)}
          </select>
        </>}>
        <ErrorBox error={stock.error} />
        {stock.loading && !stock.data ? <Loading /> : !stock.data?.length ? <Empty>No stock lines.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Shelter</th><th>Item</th><th>Category</th><th className="r">Available</th><th className="r">Reorder at</th><th>Health</th><th>Updated</th></tr></thead>
            <tbody>{stock.data.map((l) => (
              <tr key={l.stock_id}>
                <td>{l.shelter_name}</td><td>{l.item_name}</td><td className="muted">{l.category}</td>
                <td className="r num">{l.quantity_available} {l.unit}</td>
                <td className="r">
                  <input type="number" min={0} defaultValue={l.reorder_threshold} style={{ width: 72, padding: '3px 6px', textAlign: 'right' }}
                    onBlur={async (e) => {
                      const v = Number(e.target.value);
                      if (v !== l.reorder_threshold && (await run(() => api('/api/inventory/threshold', { body: { stock_id: l.stock_id, reorder_threshold: v } }), 'Threshold updated'))) stock.reload();
                    }} />
                </td>
                <td><Badge v={l.health} /></td>
                <td className="small muted">{fmtTime(l.last_updated)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <Card className="mt" pad={false} title="Low-stock alerts" sub={<>Rows written by trigger into <DbTag>STOCK_ALERT</DbTag></>}
        actions={<button className="btn sm" disabled={busy} onClick={async () => {
          if (await run(() => api<{ deleted: number }>('/api/inventory/alerts', { method: 'DELETE' }), (r) => `${r.deleted} resolved alerts purged`)) alerts.reload();
        }}>Purge resolved</button>}>
        {!alerts.data?.length ? <Empty>No alerts.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Raised</th><th>Shelter</th><th>Item</th><th className="r">Qty at alert</th><th className="r">Threshold</th><th className="r">Now</th><th>State</th></tr></thead>
            <tbody>{alerts.data.map((a) => (
              <tr key={a.alert_id}>
                <td className="small">{fmtTime(a.alert_time)}</td><td>{a.shelter_name}</td><td>{a.item_name}</td>
                <td className="r num">{a.quantity_at_alert}</td><td className="r num">{a.reorder_threshold}</td><td className="r num">{a.quantity_now}</td>
                <td><Badge v={a.is_resolved ? 'resolved' : 'LOW'} label={a.is_resolved ? 'resolved' : 'open'} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {toastNode}
    </>
  );
}

export default function InventoryPage() {
  return <Suspense fallback={<Loading />}><InventoryInner /></Suspense>;
}
