/**
 * Raised when a provider cannot serve a request because the gateway is not
 * configured for it — a missing API key, most commonly. The error handler
 * maps this to a 503 so one unconfigured provider does not take the whole
 * catalogue down.
 */
export class ProviderUnavailableError extends Error {}
