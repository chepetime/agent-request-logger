/** Discovery is optional: unavailable or authenticated listings fall back to manual entry. */
export async function discoverModels(base: string): Promise<string[]> {
  try {
    const url = new URL(base);
    const prefix = url.pathname.replace(/\/+$/, "");
    url.pathname = prefix + (prefix.endsWith("/v1") ? "/models" : "/v1/models");
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const result = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return [
      ...new Set(
        (result.data ?? []).flatMap((item) =>
          typeof item?.id === "string" && item.id.trim() ? [item.id] : [],
        ),
      ),
    ];
  } catch {
    return [];
  }
}
