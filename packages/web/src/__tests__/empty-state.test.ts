import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyState from '$lib/components/EmptyState.svelte';

describe('EmptyState', () => {
  it('renders title and message', () => {
    render(EmptyState, {
      props: {
        title: 'No items',
        message: 'Create one to get started.',
      },
    });

    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
  });

  it('renders action button when actionLabel and onaction provided', () => {
    const onaction = () => {};
    render(EmptyState, {
      props: {
        title: 'Empty',
        actionLabel: 'Create',
        onaction,
      },
    });

    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Create').tagName).toBe('BUTTON');
  });

  it('does not render action button without actionLabel', () => {
    render(EmptyState, {
      props: {
        title: 'Empty',
        message: 'Nothing here.',
      },
    });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders without title', () => {
    render(EmptyState, {
      props: {
        message: 'Just a message',
      },
    });

    expect(screen.getByText('Just a message')).toBeInTheDocument();
  });
});
