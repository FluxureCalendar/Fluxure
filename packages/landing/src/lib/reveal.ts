import type { Action } from 'svelte/action';

interface RevealOptions {
  threshold?: number;
  delay?: number;
}

export const reveal: Action<HTMLElement, RevealOptions | undefined> = (node, options) => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    return {};
  }

  node.classList.add('reveal');

  const threshold = options?.threshold ?? 0.1;
  const delay = options?.delay ?? 0;

  if (delay) {
    node.style.transitionDelay = `${delay}ms`;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          node.classList.add('visible');
          observer.unobserve(node);
        }
      }
    },
    { threshold },
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    },
  };
};
