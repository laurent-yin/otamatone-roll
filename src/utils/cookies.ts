interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
}

const isBrowser = () => typeof document !== 'undefined';

/**
 * Retrieves a cookie value by name.
 *
 * @param name - The name of the cookie to retrieve
 * @returns The cookie value, or undefined if not found or not in browser
 *
 * @example
 * getCookie('session_id') // "abc123" or undefined
 */
export const getCookie = (name: string): string | undefined => {
  if (!isBrowser()) {
    return undefined;
  }

  const encodedName = encodeURIComponent(name);
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split('=');
    if (key === encodedName) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
};

/**
 * Sets a cookie with the specified name, value, and options.
 *
 * @param name - The name of the cookie
 * @param value - The value to store
 * @param options - Cookie options
 * @param options.maxAgeSeconds - Maximum age in seconds (omit for session cookie)
 * @param options.path - Cookie path (defaults to "/")
 *
 * @example
 * setCookie('theme', 'dark', { maxAgeSeconds: 86400 }) // Expires in 1 day
 * setCookie('session', 'abc123') // Session cookie
 */
export const setCookie = (
  name: string,
  value: string,
  { maxAgeSeconds, path = '/' }: CookieOptions = {}
) => {
  if (!isBrowser()) {
    return;
  }

  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (typeof maxAgeSeconds === 'number') {
    parts.push(`max-age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  parts.push(`path=${path}`);
  document.cookie = parts.join('; ');
};

/**
 * Deletes a cookie by setting its max-age to 0.
 *
 * @param name - The name of the cookie to delete
 * @param path - Cookie path (defaults to "/")
 *
 * @example
 * deleteCookie('session_id')
 */
export const deleteCookie = (name: string, path = '/') => {
  setCookie(name, '', { maxAgeSeconds: 0, path });
};
