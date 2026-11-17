import * as Cesium from 'cesium'

export interface SimulationModelLoadResult {
  model: Cesium.Model
  revoke: () => void
}

export interface SimulationModelLoaderOptions {
  url?: string
  fetcher?: typeof fetch
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

/** Download the vehicle model with progress reporting and hand ownership to the caller. */
export async function loadSimulationModel(
  options: SimulationModelLoaderOptions = {},
): Promise<SimulationModelLoadResult> {
  const url = options.url ?? '/model/subway.glb'
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(url, { signal: options.signal })
  if (!response.ok) throw new Error(`车辆模型加载失败（${response.status}）`)

  const total = Number(response.headers.get('content-length')) || 0
  let loaded = 0
  const chunks: Uint8Array[] = []
  if (response.body) {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      loaded += value.byteLength
      options.onProgress?.(total > 0 ? Math.min(0.9, loaded / total * 0.9) : 0.1)
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer())
    chunks.push(buffer)
    loaded = buffer.byteLength
    options.onProgress?.(0.9)
  }

  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }))
  try {
    const model = await Cesium.Model.fromGltfAsync({ url: blobUrl })
    options.onProgress?.(1)
    return {
      model,
      revoke: () => URL.revokeObjectURL(blobUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(blobUrl)
    throw error instanceof Error ? error : new Error('车辆模型解析失败')
  }
}

export function destroySimulationModel(result: SimulationModelLoadResult | null): void {
  if (!result) return
  result.revoke()
  if (!result.model.isDestroyed()) result.model.destroy()
}
