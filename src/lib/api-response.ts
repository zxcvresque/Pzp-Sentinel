export type ApiPayload = Record<string, unknown>;

function isApiPayload(value: unknown): value is ApiPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiErrorMessage(payload: ApiPayload) {
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error.trim()
    : null;
}

export async function readApiJson<T extends ApiPayload>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const body = await response.text();
  let payload: unknown = null;

  if (body.trim()) {
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }
  }

  const redirectedToAuth = response.redirected && /\/(login|auth)(?:[/?#]|$)/i.test(response.url);
  if (response.status === 401 || redirectedToAuth) {
    throw new Error("Your Sentinel session has expired. Close and reopen the Telegram Mini App, then try again.");
  }

  if (!isApiPayload(payload)) {
    const status = response.status ? ` (HTTP ${response.status})` : "";
    throw new Error(
      `${fallbackMessage}${status}. Sentinel received an invalid response from the checkout service. Please try again shortly.`,
    );
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(payload) ?? `${fallbackMessage} (HTTP ${response.status}).`);
  }

  return payload as T;
}
