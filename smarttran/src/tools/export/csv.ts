/**
 * 数据导出工具
 */

/** 将二维表导出为 CSV 并触发下载（UTF-8 BOM，兼容 Excel 中文） */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  const escape = (v: string | number): string => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [header.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))]
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
