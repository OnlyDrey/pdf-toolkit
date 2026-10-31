export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () =>
      reject(new Error(`Failed to read file: ${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function parsePageRange(input: string, totalPages: number): number[] {
  if (!input.trim()) throw new Error('Page range cannot be empty.')
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const pages = new Set<number>()
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const page = parseInt(part, 10)
      if (page < 1 || page > totalPages)
        throw new Error(`Page ${page} is out of range (1-${totalPages}).`)
      pages.add(page - 1)
    } else if (/^\d+-\d+$/.test(part)) {
      const [startStr, endStr] = part.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (start < 1 || start > totalPages)
        throw new Error(`Page ${start} is out of range (1-${totalPages}).`)
      if (end < 1 || end > totalPages)
        throw new Error(`Page ${end} is out of range (1-${totalPages}).`)
      if (start > end)
        throw new Error(
          `Invalid range "${part}": start must be less than or equal to end.`,
        )
      for (let p = start; p <= end; p++) pages.add(p - 1)
    } else {
      throw new Error(
        `Invalid page range segment "${part}". Use numbers or ranges like "1,3,5-8".`,
      )
    }
  }
  return Array.from(pages).sort((a, b) => a - b)
}
