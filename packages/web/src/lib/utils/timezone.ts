/**
 * Timezone grouping utility.
 * Used by settings and onboarding pages for the timezone selector.
 */

export interface TimezoneGroup {
  label: string;
  zones: string[];
}

/**
 * Group all IANA timezones by their region prefix (e.g., "America", "Europe").
 * Timezones without a region slash are collected under "Other".
 * Results are sorted alphabetically by region label.
 */
export function groupTimezones(): TimezoneGroup[] {
  const allZones = Intl.supportedValuesOf('timeZone');
  const groups: Record<string, string[]> = {};
  const ungrouped: string[] = [];

  for (const tz of allZones) {
    const slashIdx = tz.indexOf('/');
    if (slashIdx > 0) {
      const region = tz.substring(0, slashIdx);
      if (groups[region]) {
        groups[region].push(tz);
      } else {
        groups[region] = [tz];
      }
    } else {
      ungrouped.push(tz);
    }
  }

  const result: TimezoneGroup[] = Object.entries(groups)
    .map(([label, zones]) => ({ label, zones: zones.sort() }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (ungrouped.length > 0) {
    result.push({ label: 'Other', zones: ungrouped.sort() });
  }

  return result;
}
