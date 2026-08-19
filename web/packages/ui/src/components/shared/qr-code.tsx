"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { cn } from "../../lib/utils";

/**
 * Renders a string as a QR code.
 *
 * Encoding happens in the browser, in an effect, rather than being fetched as an
 * image: the only thing we ever put in one of these is an `otpauth://` URI, which
 * carries the TOTP secret. Sending that to an image service — even our own — would
 * put the shared secret in a URL, where it lands in access logs.
 *
 * `qrcode` draws to a data URL. The value is rendered as text beneath by the
 * caller, because a QR is unusable on the device that is displaying it and every
 * authenticator app also accepts the key typed in by hand.
 */
export const QrCode = ({ value, size = 176, className }: { value: string; size?: number; className?: string }) => {
  const [dataUrl, setDataUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => live && setDataUrl(url))
      .catch(() => live && setFailed(true));
    // Cancel on unmount so a slow encode can't set state on a gone component.
    return () => {
      live = false;
    };
  }, [value, size]);

  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
      >
        Couldn&apos;t draw the QR code — enter the key below manually instead.
      </div>
    );
  }

  return (
    // Rendered on a fixed white ground: a dark-theme background behind a QR breaks
    // the contrast scanners rely on.
    <div
      className={cn("flex items-center justify-center rounded-md bg-white p-2", className)}
      style={{ width: size, height: size }}
    >
      {dataUrl ? (
        <img src={dataUrl} alt="QR code for enrolling your authenticator app" className="size-full" />
      ) : (
        <div className="size-full animate-pulse rounded bg-neutral-200" />
      )}
    </div>
  );
};
