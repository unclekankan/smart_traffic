/**
 * 轻量类型化事件发射器
 *
 * map2d / map3d 引擎共同继承：引擎向上层（组件 / store）
 * 通报选择、指针、就绪等事件，避免引擎直接依赖 Vue。
 */

export type Listener<T> = T extends void ? () => void : (payload: T) => void

export class TypedEmitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  /** 订阅事件，返回取消订阅函数 */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as (payload: never) => void)
    return () => {
      set.delete(listener as (payload: never) => void)
    }
  }

  emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends void ? [] : [Events[K]]
  ): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of set) (fn as (p?: Events[K]) => void)(args[0] as Events[K])
  }

  clear(): void {
    this.listeners.clear()
  }
}
