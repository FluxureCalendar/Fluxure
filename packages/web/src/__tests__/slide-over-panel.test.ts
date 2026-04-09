import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import SlideOverPanel from '$lib/components/SlideOverPanel.svelte';

function renderPanel(open: boolean, onclose = vi.fn()) {
  const children = createRawSnippet(() => ({
    render: () => '<div>Panel content</div>',
  }));

  return {
    onclose,
    ...render(SlideOverPanel, {
      props: {
        open,
        title: 'Edit Item',
        onclose,
        children,
      },
    }),
  };
}

describe('SlideOverPanel', () => {
  it('renders nothing when closed', () => {
    renderPanel(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog when open', () => {
    renderPanel(true);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-label', 'Edit Item');
    expect(screen.getByText('Edit Item')).toBeInTheDocument();
  });

  it('calls onclose when Escape is pressed', async () => {
    const onclose = vi.fn();
    renderPanel(true, onclose);

    const dialog = screen.getByRole('dialog');
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('calls onclose when backdrop is clicked', async () => {
    const onclose = vi.fn();
    renderPanel(true, onclose);

    const backdrop = document.querySelector('.slideover-backdrop');
    expect(backdrop).not.toBeNull();
    await fireEvent.click(backdrop!);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('has close button', () => {
    renderPanel(true);
    const closeBtn = screen.getByLabelText('Close panel');
    expect(closeBtn).toBeInTheDocument();
  });
});
