/** Persistence for the last played station. */

const LAST_INDEX_KEY = 'lastRadioIndex';

export function getStoredStationIndex(stationCount: number): number | null {
  const parsed = Number.parseInt(localStorage.getItem(LAST_INDEX_KEY) ?? '', 10);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0 || parsed >= stationCount) return null;
  return parsed;
}

export function saveLastIndex(index: number): void {
  localStorage.setItem(LAST_INDEX_KEY, String(index));
}
