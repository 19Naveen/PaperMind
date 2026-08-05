import { NextRequest } from 'next/server';
import { getRun, getWorkspaceSession } from '@/lib/api';

/**
 * Poll endpoint for a session's run. The client polls this while the run is
 * pending/running; the cookie forwarding stays server-side, so the browser never
 * talks to FastAPI directly (§4.1). Returns the session (its status flips as the
 * run progresses) plus the run when one is linked.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await params;
  const session = await getWorkspaceSession(id, sessionId).catch(() => null);
  if (!session) {
    return Response.json({ session: null, run: null });
  }
  const run = session.run_id ? await getRun(session.run_id).catch(() => null) : null;
  return Response.json({ session, run });
}
