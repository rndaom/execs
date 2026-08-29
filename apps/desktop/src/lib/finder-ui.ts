export function confirmEnabled(selectedPath: string | null, scanning: boolean): boolean {
  return Boolean(selectedPath) && !scanning;
}

export function formatInstallLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}
