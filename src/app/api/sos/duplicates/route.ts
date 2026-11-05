import { handle, requireUser } from '@/lib/api';
import { findPossibleDuplicates } from '@/lib/services/sos';
import { duplicateCheckSchema } from '@/lib/validation';

// Vector similarity + geo radius + time window, run before an SOS is submitted
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    return findPossibleDuplicates(duplicateCheckSchema.parse(await req.json()));
  });
}
