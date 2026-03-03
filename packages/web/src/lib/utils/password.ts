import { PASSWORD_MIN_LENGTH, PASSWORD_STRONG_LENGTH } from '@fluxure/shared';

export function getPasswordStrength(pw: string): 'weak' | 'fair' | 'strong' {
  let score = 0;
  if (pw.length >= PASSWORD_MIN_LENGTH) score++;
  if (pw.length >= PASSWORD_STRONG_LENGTH) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z\d]/.test(pw)) score++;
  if (score <= 2) return 'weak';
  if (score <= 3) return 'fair';
  return 'strong';
}
