/**
 * Centralized translation layer between Supabase Auth error codes and the
 * human-readable text we show to users.
 *
 * Why this file exists:
 *   1. Supabase Auth error messages (`error.message`) are not part of the
 *      stable API and can change between releases. The Supabase docs
 *      explicitly tell you to identify errors by `error.code` (server) or
 *      `error.name` (client), not by string-matching the message.
 *   2. The codes themselves (`invalid_credentials`, `over_request_rate_limit`,
 *      ...) are great identifiers but terrible UI copy. We map them once,
 *      here, into messages that tell the user what to do.
 *   3. Keeping every user-visible auth string in one file makes future i18n
 *      a one-file change.
 *
 * Source for the canonical code list:
 *   https://github.com/supabase/auth-js/blob/master/src/lib/error-codes.ts
 *   (also documented at https://supabase.com/docs/guides/auth/debugging/error-codes)
 *
 * If a new code shows up that's not in this map, we fall back to a generic
 * message AND log the unmapped code on the server so we notice and add it.
 */

/**
 * The set of Supabase Auth error codes we explicitly handle, plus the
 * MastraClaw-internal codes our own validation produces. The string-literal
 * union gives TypeScript autocomplete at every call site.
 */
export type AuthErrorCode =
  // --- MastraClaw-internal (produced by our own server actions) ---
  | 'missing_credentials'
  | 'unknown'
  // --- Supabase Auth — sign-in & credentials ---
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'phone_not_confirmed'
  | 'user_not_found'
  | 'user_banned'
  // --- Supabase Auth — input validation ---
  | 'validation_failed'
  | 'email_address_invalid'
  | 'email_address_not_authorized'
  | 'weak_password'
  | 'bad_json'
  // --- Supabase Auth — provider / account state ---
  | 'signup_disabled'
  | 'email_provider_disabled'
  | 'phone_provider_disabled'
  | 'provider_disabled'
  | 'anonymous_provider_disabled'
  // --- Supabase Auth — rate limiting ---
  | 'over_request_rate_limit'
  | 'over_email_send_rate_limit'
  | 'over_sms_send_rate_limit'
  // --- Supabase Auth — security / abuse ---
  | 'captcha_failed'
  | 'reauthentication_needed'
  // --- Supabase Auth — session ---
  | 'session_not_found'
  | 'session_expired'
  | 'bad_jwt'
  | 'no_authorization'
  // --- Supabase Auth — server / network ---
  | 'request_timeout'
  | 'unexpected_failure';

/**
 * The user-facing copy. Keep messages:
 *  - Short (one or two sentences max)
 *  - Specific where we know what's wrong
 *  - Actionable (tell the user what to do next)
 *  - Calm in tone — never blame the user, never use exclamation marks
 */
const messages: Record<AuthErrorCode, string> = {
  // --- MastraClaw-internal ---
  missing_credentials:
    'Please enter both your email address and your password.',
  unknown:
    "We couldn't sign you in right now. Please try again in a moment, and contact support if it keeps happening.",

  // --- Sign-in & credentials ---
  invalid_credentials:
    "Those credentials don't match. Double-check your email and password and try again.",
  email_not_confirmed:
    'Please confirm your email address first. Check your inbox for the confirmation link we sent when you signed up.',
  phone_not_confirmed:
    'Please confirm your phone number first. Check your messages for the verification code we sent.',
  user_not_found:
    "We couldn't find an account with that email address.",
  user_banned:
    'This account has been suspended. Contact support if you believe this is a mistake.',

  // --- Input validation ---
  validation_failed:
    'Some of the values you entered are not valid. Please review the form and try again.',
  email_address_invalid:
    "That doesn't look like a valid email address.",
  email_address_not_authorized:
    'This email address is not authorized to sign in. Contact your administrator if you believe this is a mistake.',
  weak_password:
    'That password is too weak. Choose a longer one with a mix of letters, numbers, and symbols.',
  bad_json:
    'The sign-in request was malformed. Please reload the page and try again.',

  // --- Provider / account state ---
  signup_disabled:
    'New sign-ups are currently disabled.',
  email_provider_disabled:
    'Email sign-in is currently disabled. Contact your administrator.',
  phone_provider_disabled:
    'Phone sign-in is currently disabled.',
  provider_disabled:
    'This sign-in method is currently disabled. Try a different one.',
  anonymous_provider_disabled:
    'Anonymous sign-in is currently disabled.',

  // --- Rate limiting ---
  over_request_rate_limit:
    'Too many sign-in attempts. Please wait a minute before trying again.',
  over_email_send_rate_limit:
    "We've sent too many emails to this address recently. Please wait a few minutes before trying again.",
  over_sms_send_rate_limit:
    "We've sent too many text messages recently. Please wait a few minutes before trying again.",

  // --- Security / abuse ---
  captcha_failed:
    'Captcha verification failed. Please reload the page and try again.',
  reauthentication_needed:
    'For security reasons, please sign in again to continue.',

  // --- Session ---
  session_not_found:
    'Your session has ended. Please sign in again.',
  session_expired:
    'Your session has expired. Please sign in again.',
  bad_jwt:
    'Your session is invalid. Please sign in again.',
  no_authorization:
    'You need to be signed in to do that.',

  // --- Server / network ---
  request_timeout:
    'The sign-in request took too long. Check your connection and try again.',
  unexpected_failure:
    "Something went wrong on our side. Please try again in a moment.",
};

/**
 * Maps an arbitrary value (typically `error.code` from supabase-js, but
 * could be any string from a URL parameter) to a friendly user-facing
 * message. Always returns a string — falls back to the `unknown` message
 * if the code is missing or not recognised.
 *
 * If an unknown code is passed, we log it server-side so we notice and
 * add a mapping for it. (No-op in the browser.)
 */
export function mapAuthError(code: string | null | undefined): string {
  if (!code) return messages.unknown;
  if (code in messages) {
    return messages[code as AuthErrorCode];
  }
  if (typeof window === 'undefined') {
    // Server-side only — surfaces in `next dev` logs.
    console.warn(
      `[mastra-claw] Unmapped auth error code: ${code}. ` +
        `Add it to src/lib/auth-errors.ts.`,
    );
  }
  return messages.unknown;
}
