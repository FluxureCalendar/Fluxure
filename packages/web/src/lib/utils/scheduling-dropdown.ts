import type { SchedulingTemplate } from '$lib/api';
import { SchedulingHours } from '@fluxure/shared';

/**
 * Handle a scheduling dropdown change event. Parses template: prefixed values
 * and calls the appropriate setter.
 */
export function handleScheduleDropdownChange(
  value: string,
  templates: SchedulingTemplate[],
  setFields: (schedulingHours: SchedulingHours, templateId: string | null) => void,
): void {
  if (value.startsWith('template:')) {
    const tmplId = value.slice('template:'.length);
    const tmpl = templates.find((t) => t.id === tmplId);
    if (tmpl) {
      setFields(SchedulingHours.Custom, tmplId);
    }
  } else {
    setFields(value as SchedulingHours, null);
  }
}

/**
 * Get the current value for the scheduling dropdown based on state.
 */
export function getScheduleDropdownValue(
  schedulingHours: string,
  selectedTemplateId: string | null,
): string {
  if (selectedTemplateId) return `template:${selectedTemplateId}`;
  return schedulingHours;
}
