import { parentPort } from 'worker_threads';
import { reschedule } from '@fluxure/engine';

if (!parentPort) {
  throw new Error('scheduler-worker must be run as a Worker thread');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Worker thread receives serialized data; runtime types match engine signatures
parentPort.on('message', (msg: { id: string; inputs: Record<string, any> }) => {
  try {
    const { habits, tasks, meetings, focusRules, calendarEvents, bufferConfig, userSettings, now } =
      msg.inputs;
    const result = reschedule(
      habits,
      tasks,
      meetings,
      focusRules,
      calendarEvents,
      bufferConfig,
      userSettings,
      now ? new Date(now as string) : undefined,
    );
    parentPort!.postMessage({ id: msg.id, result });
  } catch (err: unknown) {
    parentPort!.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
