import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { autoMatchAll } from '@/lib/services/sos';

// CALL sp_auto_match_unmatched (cursor over unmatched SOS, most urgent first)
export async function POST() {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return autoMatchAll(db, user);
  });
}
