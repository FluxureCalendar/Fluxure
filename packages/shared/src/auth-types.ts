import type { PlanType } from './plan-limits.js';

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  gdprConsent: true;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  googleId: string | null;
  hasPassword: boolean;
  plan: PlanType;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface OnboardingData {
  timezone: string;
  workingHours: { start: string; end: string };
  personalHours: { start: string; end: string };
  schedulingWindowDays: number;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface DeleteAccountRequest {
  confirm: true;
  password?: string;
  email?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  plan: PlanType;
  emailVerified: boolean;
  hasGdprConsent: boolean;
  gdprConsentVersion?: string;
}
