import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

import { logger } from "../observability/logger";
import { env } from "../config/env";

/**
 * Object storage for the source documents behind the processing registry.
 *
 * S3-compatible rather than S3-specific: the same code talks to AWS S3 in
 * production and to MinIO in `docker compose` locally, which is why the endpoint
 * and path-style addressing are configurable (see `S3_ENDPOINT`,
 * `S3_FORCE_PATH_STYLE`).
 *
 * **Storing the file is opt-in** (`BLOB_STORAGE_ENABLED`). The registry itself is
 * metadata-only, and keeping the bytes is a different privacy posture — it must be
 * a deliberate choice, not something that arrives with a deploy. Every function
 * here no-ops or returns `undefined` when storage is off, so callers need no
 * branch of their own.
 *
 * The same sensitivity rule as the registry applies upstream: `pii`/`restricted`
 * documents are never recorded, so their bytes are never uploaded either.
 */

let client: S3Client | undefined;

/** True when object storage is configured and switched on. */
export const blobStorageEnabled = (): boolean => env.BLOB_STORAGE_ENABLED === "true";

/**
 * Lazily-built client, so a deployment with storage off never constructs one (and
 * never needs credentials). Credentials are omitted entirely when unset, which lets
 * the SDK fall back to the instance role / ambient provider chain in production.
 */
const getClient = (): S3Client => {
  if (!client) {
    client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }
  return client;
};

/** Test seam: swap in a stub client (or clear it) without reaching into module state. */
export const setBlobClient = (next: S3Client | undefined): void => {
  client = next;
};

/**
 * Storage key for one document.
 *
 * Tenant-prefixed so a bucket policy or lifecycle rule can be scoped per tenant,
 * and date-partitioned so a prefix listing stays manageable as the bucket grows.
 * The random suffix — not the filename — carries the uniqueness: two tenants
 * uploading `invoice.pdf` on the same day must not collide, and a filename is
 * attacker-controlled input that has no business deciding a storage path.
 */
export const documentKey = (tenantId: string, fileName: string): string => {
  const day = new Date().toISOString().slice(0, 10);
  return `documents/${encodeURIComponent(tenantId)}/${day}/${randomUUID()}/${sanitizeFileName(fileName)}`;
};

/**
 * Strips anything that could escape the key prefix or confuse a downstream client.
 * Traversal segments go first, then any character outside a conservative allowlist.
 */
const sanitizeFileName = (name: string): string => {
  const base = name.split(/[/\\]/).pop() ?? "document";
  const cleaned = base.replace(/[^\w.\-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "document";
};

/**
 * Uploads one document, returning its storage key — or `undefined` if storage is
 * off or the upload failed.
 *
 * Failure is deliberately non-fatal: the OCR request it belongs to has already
 * succeeded, and losing the archived copy must not turn that into an error the
 * caller sees. The registry simply records the document with no key, so it lists
 * normally and is merely not downloadable.
 */
export const putDocument = async (input: {
  tenantId: string;
  fileName: string;
  body: Buffer;
  contentType?: string;
}): Promise<string | undefined> => {
  if (!blobStorageEnabled()) return undefined;

  const key = documentKey(input.tenantId, input.fileName);
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: input.body,
        ContentType: input.contentType || "application/octet-stream",
        // Recorded on the object so the bucket is self-describing: an operator
        // auditing storage directly can attribute a key without the database.
        Metadata: { tenantId: input.tenantId, originalName: sanitizeFileName(input.fileName) },
      }),
    );
    return key;
  } catch (err) {
    logger.warn("blob.put.failed", {
      tenantId: input.tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
};

/**
 * A short-lived presigned URL for downloading one document.
 *
 * Presigned rather than streamed through the API: the bytes go straight from the
 * store to the browser instead of occupying an API process for the length of a
 * large download. The link is a bearer credential, so its TTL is deliberately
 * short (`S3_DOWNLOAD_URL_TTL_SECONDS`) — authorization happens when the link is
 * issued, and the route issuing it is the thing that checks tenant ownership.
 */
export const presignDownload = async (key: string, fileName?: string): Promise<string | undefined> => {
  if (!blobStorageEnabled()) return undefined;

  try {
    return await getSignedUrl(
      getClient(),
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        // Makes the browser save it under the original name rather than the uuid key.
        ...(fileName ? { ResponseContentDisposition: `attachment; filename="${sanitizeFileName(fileName)}"` } : {}),
      }),
      { expiresIn: env.S3_DOWNLOAD_URL_TTL_SECONDS },
    );
  } catch (err) {
    logger.warn("blob.presign.failed", { err: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
};

/** S3 caps a single DeleteObjects call at 1000 keys. */
const DELETE_BATCH = 1000;

/**
 * Deletes objects by key, returning how many the store accepted.
 *
 * Used by the retention sweep. Without this, "retention" would delete the database
 * row and silently leave the document itself in the bucket forever — the row is the
 * index, not the data.
 */
export const deleteDocuments = async (keys: string[]): Promise<number> => {
  if (!blobStorageEnabled() || keys.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH);
    try {
      const res = await getClient().send(
        new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      // `Errors` is populated even on an otherwise-successful call (per-key failures).
      const failed = res.Errors?.length ?? 0;
      if (failed > 0) logger.warn("blob.delete.partial", { failed, attempted: batch.length });
      deleted += batch.length - failed;
    } catch (err) {
      logger.warn("blob.delete.failed", {
        attempted: batch.length,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return deleted;
};

/**
 * Verifies the bucket is reachable. Called from the health check so a
 * misconfigured store surfaces on the dashboard rather than as a stream of
 * warnings from failed uploads.
 */
export const checkBlobStorage = async (): Promise<{ ok: boolean; detail?: string }> => {
  if (!blobStorageEnabled()) return { ok: true, detail: "disabled" };

  try {
    await getClient().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return { ok: true, detail: env.S3_BUCKET };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
};
