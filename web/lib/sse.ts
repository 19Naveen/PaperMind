/**
 * Consume an SSE response body, invoking `onEvent` for each `data:` frame.
 * Both chat streams (session + studio) parse the same event shape, so the
 * loop lives here once instead of being duplicated per conversation.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (payload: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
        } catch {
          // malformed event frame — skip rather than kill the stream
        }
      }
    }
  }
}
