export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}
