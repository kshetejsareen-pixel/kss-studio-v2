// Runs fn over items with at most `limit` calls in flight. Results keep the input order;
// a failed item becomes { error } instead of stopping the rest (aborts still stop).
export async function mapLimit(items, limit, fn, { signal } = {}) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const i = next++
      try {
        out[i] = { value: await fn(items[i], i) }
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        out[i] = { error: err }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export const chunk = (list, size) => {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
