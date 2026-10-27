/**
 * 轻量 HTTP 客户端（基于原生 fetch，无额外依赖）
 *
 * 所有请求经 Vite 代理（/api -> 127.0.0.1:8000）转发到 FastAPI 后端。
 */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function request<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = (body as { detail?: string }).detail ?? detail
    } catch {
      /* ignore */
    }
    throw new HttpError(res.status, detail)
  }
  return (await res.json()) as T
}
