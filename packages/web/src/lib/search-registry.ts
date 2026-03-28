import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
import Flame from 'lucide-svelte/icons/flame';
import CircleCheckBig from 'lucide-svelte/icons/circle-check-big';

import Brain from 'lucide-svelte/icons/brain';
import ExternalLink from 'lucide-svelte/icons/external-link';
import TrendingUp from 'lucide-svelte/icons/trending-up';
import Settings2 from 'lucide-svelte/icons/settings-2';
import Calendar from 'lucide-svelte/icons/calendar';
import Clock from 'lucide-svelte/icons/clock';
import CreditCard from 'lucide-svelte/icons/credit-card';
import UserIcon from 'lucide-svelte/icons/user';
import Shield from 'lucide-svelte/icons/shield';
import Globe from 'lucide-svelte/icons/globe';

// ─── Navigation Registry ─────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

export const NAV_REGISTRY: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Habits', href: '/habits', icon: Flame },
  { label: 'Tasks', href: '/tasks', icon: CircleCheckBig },

  { label: 'Focus time', href: '/focus', icon: Brain },
  { label: 'Links', href: '/links', icon: ExternalLink },
  { label: 'Analytics', href: '/analytics', icon: TrendingUp },
  { label: 'Settings', href: '/settings', icon: Settings2 },
];

// ─── Settings Registry ───────────────────────────────────────

export interface SearchableSetting {
  id: string;
  label: string;
  tab: string;
  icon: typeof LayoutDashboard;
  keywords: string[];
}

export const SETTINGS_REGISTRY: SearchableSetting[] = [
  {
    id: 'timezone',
    label: 'Timezone',
    tab: 'general',
    icon: Globe,
    keywords: ['time zone', 'tz', 'region'],
  },
  {
    id: 'working-hours',
    label: 'Working hours',
    tab: 'general',
    icon: Clock,
    keywords: ['work start', 'work end', 'schedule'],
  },
  {
    id: 'personal-hours',
    label: 'Personal hours',
    tab: 'general',
    icon: Clock,
    keywords: ['evening', 'personal time'],
  },
  {
    id: 'free-slot-on-complete',
    label: 'Free slot on complete',
    tab: 'general',
    icon: Settings2,
    keywords: ['auto free', 'complete'],
  },
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    tab: 'calendars',
    icon: Calendar,
    keywords: ['connect', 'sync', 'google'],
  },
  {
    id: 'scheduling-templates',
    label: 'Scheduling templates',
    tab: 'templates',
    icon: Clock,
    keywords: ['preset', 'time window', 'template'],
  },
  {
    id: 'billing-plan',
    label: 'Billing & plan',
    tab: 'billing',
    icon: CreditCard,
    keywords: ['subscription', 'pro', 'upgrade', 'payment'],
  },
  {
    id: 'account-email',
    label: 'Account email',
    tab: 'account',
    icon: UserIcon,
    keywords: ['email', 'change email'],
  },
  {
    id: 'account-password',
    label: 'Password',
    tab: 'account',
    icon: UserIcon,
    keywords: ['password', 'change password'],
  },
  {
    id: 'account-delete',
    label: 'Delete account',
    tab: 'account',
    icon: UserIcon,
    keywords: ['delete', 'remove account'],
  },
  {
    id: 'privacy-export',
    label: 'Export data',
    tab: 'privacy',
    icon: Shield,
    keywords: ['gdpr', 'export', 'download'],
  },
  {
    id: 'privacy-consent',
    label: 'Data consent',
    tab: 'privacy',
    icon: Shield,
    keywords: ['gdpr', 'consent', 'tracking'],
  },
  {
    id: 'privacy-sessions',
    label: 'Active sessions',
    tab: 'privacy',
    icon: Shield,
    keywords: ['session', 'logout', 'devices'],
  },
  {
    id: 'scheduling-window',
    label: 'Scheduling window',
    tab: 'general',
    icon: Clock,
    keywords: ['days ahead', 'range', 'how far'],
  },
  {
    id: 'trim-completed',
    label: 'Trim completed events',
    tab: 'general',
    icon: Settings2,
    keywords: ['shrink', 'complete', 'trim'],
  },
  {
    id: 'auto-complete-habits',
    label: 'Auto-complete habits',
    tab: 'general',
    icon: Settings2,
    keywords: ['auto complete', 'habit done', 'automatic', 'finish'],
  },
  {
    id: 'buffer-break',
    label: 'Break between items',
    tab: 'general',
    icon: Clock,
    keywords: ['gap', 'break', 'buffer', 'spacing'],
  },
  {
    id: 'default-habit-calendar',
    label: 'Default habit calendar',
    tab: 'calendars',
    icon: Calendar,
    keywords: ['habit calendar', 'default'],
  },
  {
    id: 'default-task-calendar',
    label: 'Default task calendar',
    tab: 'calendars',
    icon: Calendar,
    keywords: ['task calendar', 'default'],
  },
];
