export function isJwtClockSkewError(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('jwt issued at future')
    || lower.includes('issued at future')
    || lower.includes('clock skew');
}

export function authErrorMessage(message) {
  if (isJwtClockSkewError(message)) {
    return {
      title: 'Session expired — system clock may be wrong',
      detail:
        'Your computer date/time appears to be behind Supabase. Sync Windows date & time (Settings → Time & language → Date & time → Sync now), then sign out and sign in again.',
      recoverable: true,
    };
  }
  return {
    title: 'Authentication error',
    detail: message || 'Something went wrong.',
    recoverable: false,
  };
}
