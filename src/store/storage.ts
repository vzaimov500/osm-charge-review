/**
 * Browser storage checks. IndexedDB may be unavailable (private
 * windows, blocked site data); Safari may evict it. Detect up front and say so.
 */
export interface StorageStatus {
  indexedDb: boolean
  /** navigator.storage.persist() granted; undefined when the API is missing. */
  persisted: boolean | undefined
  usageBytes?: number
  quotaBytes?: number
}

export async function probeIndexedDb(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): Promise<boolean> {
  if (!idb) return false
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = idb.open('osm-charge-review-probe')
    } catch {
      resolve(false)
      return
    }
    req.onsuccess = () => {
      req.result.close()
      resolve(true)
    }
    req.onerror = () => resolve(false)
    req.onblocked = () => resolve(false)
  })
}

/**
 * Status only — never prompts. Firefox shows a permission prompt for
 * persist(), and its promise does not settle until answered, so asking is a
 * separate, user-initiated step (requestPersistence).
 */
export async function checkStorage(
  nav: Navigator | undefined = globalThis.navigator,
): Promise<StorageStatus> {
  const status: StorageStatus = { indexedDb: await probeIndexedDb(), persisted: undefined }
  const sm = nav?.storage
  if (sm?.persisted) {
    try {
      status.persisted = await sm.persisted()
    } catch {
      status.persisted = false
    }
  }
  if (sm?.estimate) {
    try {
      const e = await sm.estimate()
      if (e.usage !== undefined) status.usageBytes = e.usage
      if (e.quota !== undefined) status.quotaBytes = e.quota
    } catch {
      /* estimate is informational only */
    }
  }
  return status
}

/** True for the DOMException browsers throw when a write exceeds the quota. */
export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)
}

/** Ask the browser to keep our data (Safari eviction). Call from a click. */
export async function requestPersistence(
  nav: Navigator | undefined = globalThis.navigator,
): Promise<boolean> {
  try {
    return (await nav?.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
