export type HostingMode = 'cloud' | 'selfhosted';

const rawMode = (import.meta.env.VITE_HOSTING_MODE ?? 'selfhosted')
  .toString()
  .toLowerCase();
export const HOSTING_MODE: HostingMode =
  rawMode === 'cloud' ? 'cloud' : 'selfhosted';

const rawEnabled = (import.meta.env.VITE_SSO_ENABLED ?? 'false')
  .toString()
  .toLowerCase();
export const SSO_ENABLED: boolean = rawEnabled === 'true';

export const OAUTH_PROVIDERS: string[] = String(
  import.meta.env.VITE_OAUTH_PROVIDERS ?? ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Final decision the UI should use:
export const SHOW_SSO: boolean =
  HOSTING_MODE === 'cloud' && SSO_ENABLED && OAUTH_PROVIDERS.length > 0;
