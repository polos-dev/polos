export const getProviderLogo = (provider: string) => {
  try {
    return new URL(`../../assets/logos/${provider}.svg`, import.meta.url).href;
  } catch {
    return ''; // fallback if icon doesn't exist
  }
};
