'use client';

import { useState } from 'react';
import { Badge, Card, DbTag, Empty, ErrorBox, Loading, PageHead, api, fmtTime, useAction, useApi } from '@/components/ui';

interface Member { user_id: number; name: string; role: string; email: string; phone: string | null; home_shelter: string | null; sos_reported: number; sos_resolved: number | null; people_reported: number; last_report_at: string | null }
interface Activity { _id: string; at: string; actor: { name: string; role: string }; action: string; entity: string; entity_id: unknown }
interface ShelterLite { shelter_id: number; name: string }

const blank = { name: '', email: '', phone: '', role: 'Field Volunteer', shelter_id: '', password: '' };

export default function TeamPage() {
  const team = useApi<Member[]>('/api/users');
  const activity = useApi<Activity[]>('/api/activity');
  const shelters = useApi<ShelterLite[]>('/api/shelters');
  const { run, busy, toastNode } = useAction();
  const [f, setF] = useState(blank);

  if (team.loading && !team.data) return <Loading />;
  if (!team.data) return <ErrorBox error={team.error} />;

  return (
    <>
      <PageHead title="Team" sub={<>Accounts in <DbTag>APP_USER</DbTag> (bcrypt password hashes) · activity from <DbTag>v_volunteer_activity</DbTag></>} />
      <div className="grid g3">
        <Card className="span2" pad={false} title="Members">
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Role</th><th>Home shelter</th><th className="r">SOS filed</th><th className="r">People</th><th>Last report</th></tr></thead>
            <tbody>{team.data.map((m) => (
              <tr key={m.user_id}>
                <td>{m.name}<div className="small muted">{m.email}{m.phone ? ` · ${m.phone}` : ''}</div></td>
                <td><Badge v={m.role === 'Relief Coordinator' ? 'matched' : 'OK'} label={m.role} /></td>
                <td>{m.home_shelter ?? <span className="muted">-</span>}</td>
                <td className="r num">{m.sos_reported}</td><td className="r num">{m.people_reported}</td>
                <td className="small">{fmtTime(m.last_report_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>

        <Card title="Add team member" sub="Email/phone are also checked by DB CHECK constraints">
          <form className="stack" style={{ gap: 10 }} onSubmit={async (e) => {
            e.preventDefault();
            const body = { ...f, shelter_id: f.shelter_id ? Number(f.shelter_id) : null };
            if (await run(() => api('/api/users', { body }), `${f.name} added`)) { setF(blank); team.reload(); }
          }}>
            <input required placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input required type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input placeholder="Phone (10 digits)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option>Field Volunteer</option><option>Relief Coordinator</option>
            </select>
            <select value={f.shelter_id} onChange={(e) => setF({ ...f, shelter_id: e.target.value })}>
              <option value="">No home shelter</option>{shelters.data?.map((s) => <option key={s.shelter_id} value={s.shelter_id}>{s.name}</option>)}
            </select>
            <input required type="password" placeholder="Temporary password (8+, A-Z, 0-9)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <button className="btn dark" disabled={busy}>Create account</button>
          </form>
        </Card>
      </div>

      <Card className="mt" pad={false} title="Audit log" sub={<>Latest actions <DbTag>MongoDB · field_activity</DbTag></>}>
        {!activity.data?.length ? <Empty>No activity yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>{activity.data.map((a) => (
              <tr key={a._id}>
                <td className="small">{fmtTime(a.at)}</td><td>{a.actor.name}<div className="small muted">{a.actor.role}</div></td>
                <td><code>{a.action}</code></td><td className="small">{a.entity}{a.entity_id != null ? ` #${String(a.entity_id)}` : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {toastNode}
    </>
  );
}
