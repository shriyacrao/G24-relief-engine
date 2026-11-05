'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, DbTag, PageHead, api } from '@/components/ui';
import { DISASTER_TYPES, NEED_OPTIONS } from '@/lib/types';

const AREAS: { name: string; ll: [number, number] }[] = [
  { name: 'Koramangala', ll: [12.9352, 77.6245] },
  { name: 'Banashankari', ll: [12.9255, 77.5468] },
  { name: 'Jayanagar', ll: [12.925, 77.5938] },
  { name: 'Whitefield', ll: [12.9698, 77.75] },
  { name: 'Yelahanka', ll: [13.1007, 77.5963] },
  { name: 'Hebbal', ll: [13.0358, 77.597] },
  { name: 'Bellandur', ll: [12.926, 77.6762] },
  { name: 'Electronic City', ll: [12.8452, 77.6602] },
  { name: 'Malleshwaram', ll: [13.0035, 77.571] },
  { name: 'Rajajinagar', ll: [12.991, 77.555] },
];

/* Disaster-specific fields: these differ per disaster, which is exactly why the
   intake form lives in MongoDB instead of a fixed SQL table. */
const DETAIL_FIELDS: Record<string, { key: string; label: string; type: 'number' | 'bool' | 'text' }[]> = {
  flood: [
    { key: 'water_level_ft', label: 'Water level (ft)', type: 'number' },
    { key: 'roof_access', label: 'Stranded on roof / upper floor', type: 'bool' },
    { key: 'boat_needed', label: 'Boat needed for rescue', type: 'bool' },
  ],
  landslide: [
    { key: 'road_blocked', label: 'Access road blocked', type: 'bool' },
    { key: 'houses_damaged', label: 'Houses damaged', type: 'number' },
  ],
  building_collapse: [
    { key: 'people_trapped', label: 'People trapped', type: 'number' },
    { key: 'heavy_equipment', label: 'Heavy equipment needed', type: 'bool' },
  ],
  fire: [
    { key: 'burn_injuries', label: 'People with burns', type: 'number' },
    { key: 'smoke_inhalation', label: 'Smoke inhalation cases', type: 'bool' },
  ],
  cyclone: [
    { key: 'roof_damaged', label: 'Roof blown off / damaged', type: 'bool' },
    { key: 'power_lines_down', label: 'Power lines down', type: 'bool' },
  ],
  other: [{ key: 'situation', label: 'Situation notes', type: 'text' }],
};

interface Member { name: string; age: string; gender: string; injuries: string; medical_needs: string; is_pregnant: boolean; mobility: string }
const blankMember = (): Member => ({ name: '', age: '', gender: 'unspecified', injuries: '', medical_needs: '', is_pregnant: false, mobility: 'ok' });
const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

interface Dup { sos_id: number; score: number; urgency: string; status: string; text: string; people_count: number }
interface Result { sos_id: number; intake_id: string; vector_indexed: boolean; match: { shelter_name: string | null; error?: string } | null }

export default function NewSosPage() {
  const [disaster, setDisaster] = useState<string>('flood');
  const [urgency, setUrgency] = useState('high');
  const [description, setDescription] = useState('');
  const [area, setArea] = useState('Koramangala');
  const [lat, setLat] = useState('12.9352');
  const [lon, setLon] = useState('77.6245');
  const [address, setAddress] = useState('');
  const [members, setMembers] = useState<Member[]>([blankMember()]);
  const [peopleCount, setPeopleCount] = useState<string>('1');
  const [peopleTouched, setPeopleTouched] = useState(false);
  const [needs, setNeeds] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, string | boolean>>({});
  const [autoMatch, setAutoMatch] = useState(true);
  const [dups, setDups] = useState<Dup[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errSrc, setErrSrc] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => { if (!peopleTouched) setPeopleCount(String(members.length)); }, [members.length, peopleTouched]);

  // Duplicate check: vector similarity + 3 km radius + last 72 h (debounced)
  const dupKey = useMemo(() => `${description}|${lat}|${lon}|${disaster}`, [description, lat, lon, disaster]);
  useEffect(() => {
    if (description.trim().length < 15 || !Number(lat) || !Number(lon)) { setDups(null); return; }
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        setDups(await api<Dup[]>('/api/sos/duplicates', { body: { description, needs, disaster_type: disaster, lat: Number(lat), lon: Number(lon) } }));
      } catch { setDups(null); } finally { setChecking(false); }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey]);

  function pickArea(name: string) {
    setArea(name);
    const a = AREAS.find((x) => x.name === name);
    if (a) { setLat(String(a.ll[0])); setLon(String(a.ll[1])); }
  }
  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition((p) => {
      setArea('custom');
      setLat(p.coords.latitude.toFixed(5));
      setLon(p.coords.longitude.toFixed(5));
    });
  }
  const setMember = (i: number, patch: Partial<Member>) => setMembers((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setErrSrc(undefined);
    const detailPayload: Record<string, string | number | boolean> = {};
    for (const f of DETAIL_FIELDS[disaster] ?? []) {
      const v = details[f.key];
      if (v === undefined || v === '') continue;
      detailPayload[f.key] = f.type === 'number' ? Number(v) : v;
    }
    try {
      const r = await api<Result>('/api/sos', {
        body: {
          urgency, description, disaster_type: disaster,
          people_count: Number(peopleCount),
          lat: Number(lat), lon: Number(lon),
          address_text: address || (area !== 'custom' ? `${area}, Bengaluru` : undefined),
          needs,
          household: members.map((m) => ({
            name: m.name || undefined,
            age: m.age === '' ? null : Number(m.age),
            gender: m.gender,
            injuries: splitList(m.injuries),
            medical_needs: splitList(m.medical_needs),
            is_pregnant: m.is_pregnant,
            mobility: m.mobility,
          })),
          details: detailPayload,
          auto_match: autoMatch,
        },
      });
      setResult(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
      setErrSrc((e as { source?: string }).source);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <>
        <PageHead title={`SOS #${result.sos_id} filed`} sub="Written to all three databases" />
        <Card>
          <div className="stack">
            <dl className="kv">
              <dt>MySQL</dt><dd><code>CALL sp_register_sos(...)</code> → <DbTag>VICTIM_SOS</DbTag> row #{result.sos_id}</dd>
              <dt>MongoDB</dt><dd>Intake form <code>{result.intake_id}</code> in <DbTag>intake_forms</DbTag> (linked)</dd>
              <dt>pgvector</dt><dd>{result.vector_indexed ? <>384-d embedding stored in <DbTag>sos_embeddings</DbTag></> : <span style={{ color: 'var(--high)' }}>Not indexed (PostgreSQL unreachable) - run npm run seed:vectors</span>}</dd>
              {result.match && <>
                <dt>Shelter</dt>
                <dd>{result.match.shelter_name
                  ? <>Matched to <strong>{result.match.shelter_name}</strong> via <code>sp_match_sos</code></>
                  : <span style={{ color: 'var(--crit)' }}>{result.match.error}</span>}</dd>
              </>}
            </dl>
            <div className="row">
              <Link className="btn primary" href={`/sos/${result.sos_id}`}>Open SOS #{result.sos_id}</Link>
              <button className="btn" onClick={() => { setResult(null); setDescription(''); setMembers([blankMember()]); setNeeds([]); setDetails({}); setPeopleTouched(false); }}>File another</button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <PageHead title="New SOS report" sub="Core facts go to MySQL; the full household intake form goes to MongoDB; the description is embedded into PostgreSQL + pgvector.">
        <button className="btn primary" disabled={busy}>{busy ? 'Filing…' : 'File SOS'}</button>
      </PageHead>
      {error && <div className="notice err" style={{ marginBottom: 16 }}>{error}{errSrc && <span className="src">[{errSrc}]</span>}</div>}

      <div className="grid g3">
        <div className="span2 stack">
          <Card title="Situation">
            <div className="stack" style={{ gap: 12 }}>
              <div className="grid g3" style={{ gap: 12 }}>
                <label className="f">Disaster type
                  <select value={disaster} onChange={(e) => { setDisaster(e.target.value); setDetails({}); }}>
                    {DISASTER_TYPES.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
                  </select>
                </label>
                <label className="f">Urgency
                  <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                    {['critical', 'high', 'medium', 'low'].map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <label className="f">People affected
                  <input type="number" min={1} max={500} value={peopleCount} required
                    onChange={(e) => { setPeopleTouched(true); setPeopleCount(e.target.value); }} />
                </label>
              </div>
              <label className="f">What is happening? (free text - used for semantic matching)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} maxLength={1000}
                  placeholder="e.g. Family of four trapped on first floor, water still rising, grandmother needs her BP tablets" />
              </label>
              <div>
                <div className="small" style={{ fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>Needs</div>
                <div className="chips">
                  {NEED_OPTIONS.map((n) => (
                    <span key={n} className={`chip ${needs.includes(n) ? 'on' : ''}`}
                      onClick={() => setNeeds((x) => (x.includes(n) ? x.filter((y) => y !== n) : [...x, n]))}>{n}</span>
                  ))}
                </div>
              </div>
              {(DETAIL_FIELDS[disaster] ?? []).length > 0 && (
                <div className="grid g3" style={{ gap: 12 }}>
                  {DETAIL_FIELDS[disaster].map((f) => f.type === 'bool' ? (
                    <label key={f.key} className="check" style={{ alignSelf: 'end' }}>
                      <input type="checkbox" checked={!!details[f.key]} onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.checked }))} /> {f.label}
                    </label>
                  ) : (
                    <label key={f.key} className="f">{f.label}
                      <input type={f.type} min={0} value={(details[f.key] as string) ?? ''} onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card title="Household" sub="Everyone at the location - ages, injuries and medical needs drive triage"
            actions={<button type="button" className="btn sm" onClick={() => setMembers((m) => [...m, blankMember()])}>+ Add person</button>} pad={false}>
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Age</th><th>Gender</th><th>Injuries (comma-sep.)</th><th>Medical needs</th><th>Mobility</th><th>Pregnant</th><th /></tr></thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={i}>
                    <td><input value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} placeholder="optional" style={{ width: 100 }} /></td>
                    <td><input type="number" min={0} max={120} value={m.age} onChange={(e) => setMember(i, { age: e.target.value })} style={{ width: 64 }} /></td>
                    <td><select value={m.gender} onChange={(e) => setMember(i, { gender: e.target.value })}>
                      {['unspecified', 'female', 'male', 'other'].map((g) => <option key={g}>{g}</option>)}</select></td>
                    <td><input value={m.injuries} onChange={(e) => setMember(i, { injuries: e.target.value })} placeholder="leg injury, cut" style={{ width: 120 }} /></td>
                    <td><input value={m.medical_needs} onChange={(e) => setMember(i, { medical_needs: e.target.value })} placeholder="insulin" style={{ width: 110 }} /></td>
                    <td><select value={m.mobility} onChange={(e) => setMember(i, { mobility: e.target.value })}>
                      {['ok', 'limited', 'immobile'].map((g) => <option key={g}>{g}</option>)}</select></td>
                    <td><input type="checkbox" checked={m.is_pregnant} onChange={(e) => setMember(i, { is_pregnant: e.target.checked })} /></td>
                    <td>{members.length > 1 && <button type="button" className="btn ghost sm danger" onClick={() => setMembers((x) => x.filter((_, j) => j !== i))}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Location">
            <div className="stack" style={{ gap: 12 }}>
              <label className="f">Area
                <select value={area} onChange={(e) => pickArea(e.target.value)}>
                  {AREAS.map((a) => <option key={a.name}>{a.name}</option>)}
                  <option value="custom">Custom coordinates</option>
                </select>
              </label>
              <div className="grid g2" style={{ gap: 10 }}>
                <label className="f">Latitude<input value={lat} onChange={(e) => { setArea('custom'); setLat(e.target.value); }} required /></label>
                <label className="f">Longitude<input value={lon} onChange={(e) => { setArea('custom'); setLon(e.target.value); }} required /></label>
              </div>
              <button type="button" className="btn sm" onClick={useMyLocation}>Use my current location</button>
              <label className="f">Landmark / address<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="near 5th cross bus stop" /></label>
            </div>
          </Card>

          <Card title="Possible duplicates" sub={<>Similar open reports within 3 km, last 72 h <DbTag>pgvector · find_duplicate_sos()</DbTag></>}>
            {checking ? <div className="muted small">Checking…</div>
              : dups === null ? <div className="muted small">Type a description to check for duplicate reports.</div>
              : dups.length === 0 ? <div className="notice ok">No similar open report nearby.</div>
              : (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="notice warn">This may already be reported. Check before filing.</div>
                  {dups.map((d) => (
                    <Link key={d.sos_id} href={`/sos/${d.sos_id}`} target="_blank" className="card" style={{ padding: 10 }}>
                      <div className="row spread"><strong>#{d.sos_id}</strong><span className="score">sim {d.score}</span></div>
                      <div className="small clamp">{d.text}</div>
                      <div className="row small" style={{ marginTop: 4 }}><Badge v={d.urgency} /><Badge v={d.status} /><span className="muted">{d.people_count} people</span></div>
                    </Link>
                  ))}
                </div>
              )}
          </Card>

          <Card>
            <label className="check"><input type="checkbox" checked={autoMatch} onChange={(e) => setAutoMatch(e.target.checked)} /> Find the nearest shelter with free beds right away (sp_match_sos)</label>
          </Card>
        </div>
      </div>
    </form>
  );
}
