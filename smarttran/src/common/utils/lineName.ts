/**
 * 线路名称归一化
 *
 * 后端返回的线路名可能带方向说明与分期 / 环向后缀，
 * 展示与比较时统一收敛到基础名（如「地铁1号线」）。
 * 规则与后端 app/routers/metro.py 的 base_line_name 保持一致。
 */

/** 括号内容（方向说明 / 别名 / 嵌套站名） */
const PAREN_RE = /[（(][^（）()]*[)）]/g
/** 分期 / 环向 / 支线后缀 */
const SUFFIX_RE =
  /(内环|外环|北延段|南延段|东延段|西延段|临江段|支线|延长线|一期|二期|三期|四期|五期|六期)$/

/** 基础线路名：剥离嵌套括号与后缀，「地铁1号线(科学城--韦家碾)」→「地铁1号线」 */
export function baseLineName(name: string | null | undefined): string {
  const original = (name ?? '').trim()
  if (!original) return ''
  let value = original
  while (true) {
    const stripped = value.replace(PAREN_RE, '').trim()
    if (stripped === value) break
    value = stripped
  }
  while (true) {
    const stripped = value.replace(SUFFIX_RE, '').trim()
    if (stripped === value) break
    value = stripped
  }
  return value || original
}

/** 短名：去掉「地铁」前缀，如「地铁2号线」→「2号线」 */
export function shortLineName(name: string | null | undefined): string {
  return baseLineName(name).replace(/^地铁/, '')
}
