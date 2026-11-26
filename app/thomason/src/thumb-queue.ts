import { fetchDriveImageBlob } from './drive-api'

const CONCURRENCY = 6

type Job = {
  fileId: string
  resolve: (url: string) => void
  reject: (err: unknown) => void
}

const queued = new Map<string, Job[]>()
const order: string[] = []
const inFlight = new Set<string>()

function pump(): void {
  while (inFlight.size < CONCURRENCY && order.length > 0) {
    const fileId = order.shift()!
    if (!queued.has(fileId) || inFlight.has(fileId)) continue
    inFlight.add(fileId)
    void run(fileId)
  }
}

async function run(fileId: string): Promise<void> {
  const waiters = queued.get(fileId) ?? []
  queued.delete(fileId)
  try {
    let blob: Blob
    try {
      blob = await fetchDriveImageBlob(fileId, 'thumb')
    } catch {
      blob = await fetchDriveImageBlob(fileId, 'full')
    }
    const late = queued.get(fileId) ?? []
    queued.delete(fileId)
    // One object URL per waiter so a cancelled tile can revoke without breaking others.
    for (const job of [...waiters, ...late]) {
      job.resolve(URL.createObjectURL(blob))
    }
  } catch (err) {
    const late = queued.get(fileId) ?? []
    queued.delete(fileId)
    for (const job of [...waiters, ...late]) job.reject(err)
  } finally {
    inFlight.delete(fileId)
    pump()
  }
}

/** Fetch a Drive thumb with a shared concurrency limit. Dedupes in-flight/queued ids. */
export function enqueueDriveThumb(fileId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const job: Job = { fileId, resolve, reject }
    const existing = queued.get(fileId)
    if (existing) {
      existing.push(job)
      return
    }
    queued.set(fileId, [job])
    if (!inFlight.has(fileId)) {
      order.push(fileId)
      pump()
    }
  })
}
