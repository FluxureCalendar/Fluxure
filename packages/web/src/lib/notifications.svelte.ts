/**
 * Convenience notification helpers.
 * Re-exports from the global toast system with typed shortcuts
 * so pages don't need to repeat the pattern `showToast(msg, 'success')`.
 */

import { showToast } from '$lib/toast.svelte';

/** Show a success notification. */
export function showSuccess(msg: string): void {
  showToast(msg, 'success');
}

/** Show an error notification. */
export function showError(msg: string): void {
  showToast(msg, 'error');
}

/** Show an informational notification. */
export function showInfo(msg: string): void {
  showToast(msg, 'info');
}
