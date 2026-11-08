/** The browser's side of the API: one JSON call, and the error message to show. */
export interface ApiFailure {
  code: string;
  message: string;
  issues?: { path: string; message: string }[];
}

export async function sendJson<T>(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiFailure }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: { code: 'network', message: 'Could not reach Boiler Room. Try again.' },
    };
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error: ApiFailure }
    | null;
  if (!response.ok || !data || data.error) {
    return {
      ok: false,
      error: data?.error ?? { code: 'unknown', message: 'Something went wrong. Try again.' },
    };
  }
  return { ok: true, data: data as T };
}
