// Shared sync state — used to coordinate between settings and dashboard
let syncing = $state(false);

export function isSyncing(): boolean {
  return syncing;
}

export function setSyncing(value: boolean): void {
  syncing = value;
}
