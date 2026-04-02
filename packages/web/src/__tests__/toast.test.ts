import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToast, dismissToast, getToast } from '$lib/toast.svelte';

describe('Toast state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dismissToast();
  });

  it('shows a toast with correct type and message', () => {
    showToast('Saved', 'success');
    const toast = getToast();
    expect(toast).not.toBeNull();
    expect(toast!.message).toBe('Saved');
    expect(toast!.type).toBe('success');
  });

  it('shows error toast', () => {
    showToast('Something broke', 'error');
    const toast = getToast();
    expect(toast).not.toBeNull();
    expect(toast!.type).toBe('error');
    expect(toast!.message).toBe('Something broke');
  });

  it('defaults to info type', () => {
    showToast('Hello');
    const toast = getToast();
    expect(toast).not.toBeNull();
    expect(toast!.type).toBe('info');
  });

  it('auto-dismisses after duration', () => {
    showToast('Temp', 'info', 3000);
    expect(getToast()).not.toBeNull();

    vi.advanceTimersByTime(3000);
    expect(getToast()).toBeNull();
  });

  it('dismissToast clears immediately', () => {
    showToast('Hi', 'success');
    expect(getToast()).not.toBeNull();

    dismissToast();
    expect(getToast()).toBeNull();
  });

  it('replaces previous toast', () => {
    showToast('First', 'info');
    showToast('Second', 'error');
    const toast = getToast();
    expect(toast!.message).toBe('Second');
    expect(toast!.type).toBe('error');
  });
});
