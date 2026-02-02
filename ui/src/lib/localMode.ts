/**
 * Checks if local mode should be enabled.
 * Local mode is only enabled when:
 * 1. VITE_POLOS_LOCAL_MODE=true
 * 2. UI is running on a localhost address
 */
export function isLocalMode(): boolean {
  const localModeRequested = import.meta.env.VITE_POLOS_LOCAL_MODE === 'true';
  const hostname = window.location.hostname.toLowerCase();

  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';

  const localMode = localModeRequested && isLocalhost;

  if (localModeRequested && !isLocalhost) {
    console.warn(
      `VITE_POLOS_LOCAL_MODE=true ignored because hostname (${hostname}) is not localhost. `
    );
  }

  return localMode;
}
