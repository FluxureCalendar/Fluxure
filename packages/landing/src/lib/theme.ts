export function initTheme(): 'light' | 'dark' {
  // data-theme is already set by inline script in app.html
  const current = document.documentElement.getAttribute('data-theme') as 'light' | 'dark';
  return current ?? 'light';
}

export function toggleTheme(): 'light' | 'dark' {
  const current = document.documentElement.getAttribute('data-theme');
  const next: 'light' | 'dark' = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', next === 'dark' ? '#121110' : '#F7F6F4');
  }

  return next;
}
