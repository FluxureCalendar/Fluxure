/** Global toast notification state. Import showToast() from any page/component. */
import { TOAST_DEFAULT_DURATION_MS } from '@fluxure/shared';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  message: string;
  type: ToastType;
}

let current = $state<Toast | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(
  message: string,
  type: ToastType = 'info',
  durationMs = TOAST_DEFAULT_DURATION_MS,
): void {
  clearTimeout(timer);
  current = { message, type };
  timer = setTimeout(() => {
    current = null;
  }, durationMs);
}

export function dismissToast(): void {
  clearTimeout(timer);
  current = null;
}

export function getToast(): Toast | null {
  return current;
}
