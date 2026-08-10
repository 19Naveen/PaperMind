import { NextRequest } from 'next/server';
import { apiStream } from '@/lib/api';

/**
 * SSE proxy for the Pack Studio chat when editing a published Pack. Same
 * cookie-forwarding rules as the workspace pack chat route.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.sessionId !== 'string' ||
    typeof body.text !== 'string' ||
    !body.text.trim()
  ) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: 'sessionId and text are required.', details: {} } },
      { status: 422 },
    );
  }
  const upstream = await apiStream(`/studio/sessions/${body.sessionId}/messages`, {
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
