import { HttpError, handle, intParam, requireUser } from '@/lib/api';
import { addTimelineNote } from '@/lib/services/intake';
import { logActivity } from '@/lib/services/activity';
import { noteSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

// Field update appended to the intake document's timeline (MongoDB $push)
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user } = await requireUser();
    const id = intParam((await params).id);
    const { note } = noteSchema.parse(await req.json());
    if (!(await addTimelineNote(id, user, note))) throw new HttpError(404, 'No intake form linked to this SOS');
    await logActivity(user, 'sos.note', 'VICTIM_SOS', id);
    return { ok: true };
  }, 201);
}
