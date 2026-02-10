export const getProviderLogo = (provider: string) => {
  try {
    // Provider may include a suffix like "openai.responses" or "anthropic.messages"
    const prefix = provider.split('.')[0];
    return new URL(`../../assets/logos/${prefix}.svg`, import.meta.url).href;
  } catch {
    return ''; // fallback if icon doesn't exist
  }
};
