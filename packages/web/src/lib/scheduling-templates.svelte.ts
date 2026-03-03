/**
 * Composable for scheduling template state management.
 * Encapsulates template loading (cache-first) and the scheduling dropdown handler.
 */

import type { SchedulingTemplate } from '$lib/api';
import { schedulingTemplates as templatesApi } from '$lib/api';
import { getCachedTemplates, setCachedTemplates } from '$lib/cache.svelte';
import {
  handleScheduleDropdownChange as handleDropdownUtil,
  getScheduleDropdownValue as getDropdownValueUtil,
} from '$lib/utils/scheduling-dropdown';
import type { SchedulingHours } from '@fluxure/shared';

export interface SchedulingTemplateState {
  readonly templates: SchedulingTemplate[];
  readonly selectedTemplateId: string | null;
}

/**
 * Create reactive scheduling template state with cache-first loading.
 * Call `load()` in onMount to populate templates.
 * Call `handleDropdownChange(value, setter)` when the scheduling dropdown changes.
 */
export function createSchedulingTemplateState(): {
  readonly state: SchedulingTemplateState;
  load: () => Promise<void>;
  handleDropdownChange: (
    value: string,
    setFields: (hours: SchedulingHours, templateId: string | null) => void,
  ) => void;
  getDropdownValue: (schedulingHours: string) => string;
  setSelectedTemplateId: (id: string | null) => void;
} {
  let templates = $state<SchedulingTemplate[]>([]);
  let selectedTemplateId = $state<string | null>(null);

  async function load(): Promise<void> {
    const cached = getCachedTemplates();
    if (cached) {
      templates = cached;
      return;
    }
    try {
      const result = await templatesApi.list();
      templates = result.templates;
      setCachedTemplates(result.templates);
    } catch {
      // Non-critical — templates are optional
    }
  }

  function handleDropdownChange(
    value: string,
    setFields: (hours: SchedulingHours, templateId: string | null) => void,
  ): void {
    handleDropdownUtil(value, templates, (hours, tmplId) => {
      selectedTemplateId = tmplId;
      setFields(hours, tmplId);
    });
  }

  function getDropdownValue(schedulingHours: string): string {
    return getDropdownValueUtil(schedulingHours, selectedTemplateId);
  }

  function setSelectedTemplateId(id: string | null): void {
    selectedTemplateId = id;
  }

  return {
    get state() {
      return { templates, selectedTemplateId };
    },
    load,
    handleDropdownChange,
    getDropdownValue,
    setSelectedTemplateId,
  };
}
