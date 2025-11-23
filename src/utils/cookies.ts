interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
}

const isBrowser = () => typeof document !== 'undefined';

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

export const deleteCookie = (name: string, path = '/') => {
  setCookie(name, '', { maxAgeSeconds: 0, path });
};
