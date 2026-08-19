import { useQuery } from "@tanstack/react-query";

import type { OcrCatalogEntry } from "@/types/ocr";

import { tenantKeys } from "./query-keys";

/**
 * The live function catalog, through the portal's OCR proxy.
 *
 * The API reference renders its per-function section from this rather than from a
 * hand-written list: a function added to the service appears in the docs on the next
 * load, and one that changes its arguments cannot leave the documentation quietly
 * wrong. Only the surrounding prose — auth, errors, the async path — is static.
 *
 * Plain `fetch` rather than the axios client, because this proxy route returns the
 * catalog unwrapped and the `/ocr` page reads it the same way.
 */
export function useOcrCatalog() {
  return useQuery({
    queryKey: [...tenantKeys.all, "ocr", "catalog"],
    queryFn: async (): Promise<OcrCatalogEntry[]> => {
      const res = await fetch("/api/ocr/functions", { cache: "no-store" });
      const body = (await res.json()) as { functions?: OcrCatalogEntry[]; error?: { message?: string } };
      // A 401 or 500 still parses as JSON, so an unchecked `body.functions ?? []`
      // would render an empty reference with no explanation.
      if (!res.ok || body.error) throw new Error(body.error?.message ?? `Could not load the catalog (${res.status}).`);
      return body.functions ?? [];
    },
    // The catalog changes only when the service ships a new function.
    staleTime: 5 * 60_000,
    retry: false,
  });
}
