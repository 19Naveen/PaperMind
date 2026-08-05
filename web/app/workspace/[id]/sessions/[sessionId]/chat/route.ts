import { NextRequest } from 'next/server';
import { apiStream } from '@/lib/api';

/**
 * SSE proxy for session chat. The browser never holds the backend cookie (§4.1), so the
 * client posts here and this handler forwards to FastAPI with the session cookie, then
 * re-serves the event stream unchanged.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== 'string' || !body.text.trim()) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'text is required.', details: {} } }, { status: 422 });
  }
  const upstream = await apiStream(`/workspaces/${id}/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: body.text }),
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
