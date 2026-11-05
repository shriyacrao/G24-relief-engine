'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Card, DbTag, Empty, ErrorBox, Loading, PageHead, api, fmtTime, hoursLabel, useAction, useApi } from '@/components/ui';
import { useIsCoordinator } from '@/components/UserContext';
import type { HouseholdMember } from '@/lib/types';

interface Detail {
  sos: {
    sos_id: number; urgency_level: string; status: string; description: string; people_count: number; lat_long: string;
    reported_at: string; hours_waiting: number; shelter_name: string | null; reporter_name?: string; intake_doc_ref: string | null;
  };
  intake: null | {
    _id: string; disaster_type: string; address_text?: string; needs: string[]; household: HouseholdMember[];
    details?: Record<string, unknown>; timeline: { at: string; by: { name: string }; note: string }[]; reporter: { name: string };
  };
  reservations: { reservation_id: number; item_name: string; quantity_reserved: number; quantity_dispatched: number; unit: string; shelter_name: string; status: string; created_at: string }[];
  dispatches: { log_id: number; item_name: string; quantity_dispatched: number; vehicle: string | null; dispatch_status: string; dispatch_time: string; approved_by_name: string }[];
}
interface Insights {
  recommendations: { item_id: number; item_name: string; category: string; unit: string; relevance: number; matched_on: string; suggested_qty: number;
    shelters: { shelter_id: number; shelter_name: string; quantity_available: number; distance_km: number | null }[] }[];
  similar: { sos_id: number; score: number; text: string; urgency: string; status: string; people_count: number }[];
}

export default function SosDetailPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const isCoord = useIsCoordinator();
  const { data, error, loading, reload } = useApi<Detail>(`/api/sos/${id}`);
  const ins = useApi<Insights>(`/api/sos/${id}/insights`);
  const { run, busy, toastNode } = useAction();
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const { sos, intake } = data;
  const refresh = () => { reload(); ins.reload(); };

  const act = async (fn: () => Promise<unknown>, msg: string) => { if (await run(fn, msg)) refresh(); };

  return (
    <>
      <PageHead title={`SOS #${sos.sos_id}`} sub={<span className="row"><Badge v={sos.urgency_level} /><Badge v={sos.status} />
        <span>{sos.people_count} people · reported {fmtTime(sos.reported_at)}{sos.reporter_name ? ` by ${sos.reporter_name}` : ''}</span></span>}>
        {sos.status === 'unmatched' && (
          <button className="btn dark" disabled={busy} onClick={() => act(() => api(`/api/sos/${id}/match`, { method: 'POST' }), 'Matched to the nearest shelter with free beds')}>Find shelter</button>
        )}
        {isCoord && sos.status !== 'resolved' && (
          <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/sos/${id}/resolve`, { method: 'POST' }), 'Resolved - beds freed and pending reservations released')}>Mark resolved</button>
        )}
        {isCoord && (
          <button className="btn danger" disabled={busy} onClick={async () => {
            if (!confirm(`Delete SOS #${id}? Use this only for duplicate or spam reports.`)) return;
            if (await run(() => api(`/api/sos/${id}`, { method: 'DELETE' }), 'Deleted')) router.push('/sos');
          }}>Delete</button>
        )}
      </PageHead>

      <div className="grid g3">
        <div className="span2 stack">
          <Card title="Report" sub={<DbTag>MySQL · VICTIM_SOS</DbTag>}>
            <p style={{ marginTop: 0, fontSize: 15 }}>{sos.description}</p>
            <dl className="kv">
              <dt>Shelter</dt><dd>{sos.shelter_name ?? <span className="muted">not matched yet</span>}</dd>
              <dt>Location</dt><dd className="num">{sos.lat_long}{intake?.address_text ? ` · ${intake.address_text}` : ''}</dd>
              <dt>Waiting</dt><dd>{sos.status === 'resolved' ? 'resolved' : hoursLabel(sos.hours_waiting)}</dd>
              <dt>Intake ref</dt><dd><code>{sos.intake_doc_ref ?? '-'}</code></dd>
            </dl>
          </Card>

          <Card title="Intake form" sub={<DbTag>MongoDB · intake_forms</DbTag>}>
            {!intake ? <Empty>No intake document is linked to this SOS (older record).</Empty> : (
              <div className="stack">
                <div className="row">
                  <span className="tag">Disaster: {intake.disaster_type.replace('_', ' ')}</span>
                  {intake.needs.map((n) => <span key={n} className="tag">{n}</span>)}
                  {intake.details && Object.entries(intake.details).map(([k, v]) => (
                    <span key={k} className="tag">{k.replace(/_/g, ' ')}: <strong>{String(v)}</strong></span>
                  ))}
                </div>
                <div className="table-wrap"><table>
                  <thead><tr><th>Person</th><th>Age</th><th>Injuries</th><th>Medical needs</th><th>Mobility</th></tr></thead>
                  <tbody>
                    {intake.household.map((m, i) => (
                      <tr key={i}>
                        <td>{m.name || `Person ${i + 1}`} <span className="muted small">{m.gender !== 'unspecified' ? m.gender : ''}</span>{m.is_pregnant && <span className="tag">pregnant</span>}</td>
                        <td className="num">{m.age ?? '-'}</td>
                        <td>{m.injuries?.length ? m.injuries.join(', ') : <span className="muted">-</span>}</td>
                        <td>{m.medical_needs?.length ? m.medical_needs.join(', ') : <span className="muted">-</span>}</td>
                        <td><Badge v={m.mobility === 'ok' ? 'OK' : m.mobility === 'limited' ? 'WATCH' : 'OUT'} label={m.mobility} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <div>
                  <h3 style={{ marginBottom: 6 }}>Field timeline</h3>
                  <ul className="timeline">
                    {intake.timeline.map((t, i) => (
                      <li key={i}><div className="small muted">{fmtTime(t.at)} · {t.by.name}</div>{t.note}</li>
                    ))}
                  </ul>
                  <form className="row mt" onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run(() => api(`/api/sos/${id}/notes`, { body: { note } }), 'Update added')) { setNote(''); reload(); }
                  }}>
                    <input style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a field update ($push to timeline)" minLength={2} required />
                    <button className="btn" disabled={busy}>Add</button>
                  </form>
                </div>
              </div>
            )}
          </Card>

          <Card title="Reservations & dispatch" sub={<DbTag>v_reservation_detail</DbTag>} pad={false}>
            {data.reservations.length === 0 ? <Empty>No supplies reserved yet.{isCoord ? ' Use the recommendations on the right.' : ''}</Empty> : (
              <div className="table-wrap"><table>
                <thead><tr><th>#</th><th>Item</th><th className="r">Reserved</th><th className="r">Sent</th><th>From</th><th>Status</th>{isCoord && <th />}</tr></thead>
                <tbody>
                  {data.reservations.map((r) => (
                    <tr key={r.reservation_id}>
                      <td className="num">{r.reservation_id}</td><td>{r.item_name}</td>
                      <td className="r num">{r.quantity_reserved} {r.unit}</td><td className="r num">{r.quantity_dispatched}</td>
                      <td>{r.shelter_name}</td><td><Badge v={r.status} /></td>
                      {isCoord && <td>{['pending', 'committed'].includes(r.status) && (
                        <button className="btn ghost sm danger" disabled={busy}
                          onClick={() => act(() => api(`/api/reservations/${r.reservation_id}/cancel`, { method: 'POST' }), 'Reservation cancelled - stock returned by trigger')}>Cancel</button>
                      )}</td>}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {data.dispatches.length > 0 && (
              <div className="table-wrap" style={{ borderTop: '1px solid var(--line)' }}><table>
                <thead><tr><th>Log</th><th>Item</th><th className="r">Qty</th><th>Vehicle</th><th>Approved by</th><th>Status</th></tr></thead>
                <tbody>{data.dispatches.map((d) => (
                  <tr key={d.log_id}><td className="num">{d.log_id}</td><td>{d.item_name}</td><td className="r num">{d.quantity_dispatched}</td>
                    <td>{d.vehicle ?? '-'}</td><td>{d.approved_by_name}</td><td><Badge v={d.dispatch_status} /></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Recommended supplies" sub={<>Items by meaning <DbTag>pgvector</DbTag> + nearest stock <DbTag>sp_nearest_stock</DbTag></>}>
            {ins.loading && !ins.data ? <Loading what="Matching" /> : ins.error ? <ErrorBox error={ins.error} /> : !ins.data?.recommendations.length ? <Empty>No relevant items found.</Empty> : (
              <div className="stack" style={{ gap: 14 }}>
                {ins.data.recommendations.map((r) => (
                  <div key={r.item_id}>
                    <div className="row spread"><strong>{r.item_name}</strong><span className="score">sim {r.relevance}</span></div>
                    <div className="small muted">matched on “{r.matched_on}” · suggest {r.suggested_qty} {r.unit} for {sos.people_count} people</div>
                    {r.shelters.length === 0 ? <div className="small" style={{ color: 'var(--crit)' }}>No shelter has this in stock</div> : (
                      <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                        {r.shelters.map((s) => {
                          const k = `${r.item_id}-${s.shelter_id}`;
                          const q = qty[k] ?? String(Math.min(r.suggested_qty, s.quantity_available));
                          return (
                            <div key={k} className="small" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
                              <span>{s.shelter_name}<br /><span className="muted num">{s.quantity_available} left · {s.distance_km ?? '?'} km</span></span>
                              {isCoord && sos.status !== 'resolved' && (
                                <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                  <input type="number" min={1} value={q} onChange={(e) => setQty((x) => ({ ...x, [k]: e.target.value }))} style={{ width: 58, padding: '4px 6px' }} />
                                  <button className="btn sm" disabled={busy} onClick={() => act(() => api('/api/reservations', {
                                    body: { sos_id: id, item_id: r.item_id, shelter_id: s.shelter_id, quantity: Number(q) },
                                  }), `Reserved ${q} ${r.unit} of ${r.item_name} (stock deducted by trigger)`)}>Reserve</button>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Similar cases" sub={<>Cosine similarity on report text <DbTag>pgvector</DbTag></>}>
            {ins.loading && !ins.data ? <Loading /> : !ins.data?.similar.length ? <Empty>No similar reports.</Empty> : (
              <div className="stack" style={{ gap: 8 }}>
                {ins.data.similar.map((s) => (
                  <Link key={s.sos_id} href={`/sos/${s.sos_id}`} className="card" style={{ padding: 10 }}>
                    <div className="row spread"><strong>#{s.sos_id}</strong><span className="score">sim {s.score}</span></div>
                    <div className="small clamp">{s.text}</div>
                    <div className="row small" style={{ marginTop: 4 }}><Badge v={s.urgency} /><Badge v={s.status} /></div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
      {toastNode}
    </>
  );
}
