import nodemailer, { type Transporter } from "nodemailer";

import { env } from "../../config/env";
import { logger } from "../../observability/logger";

/**
 * SMTP transport for transactional email.
 *
 * Sending is best-effort by design. Every caller in this codebase is a side effect
 * of work that already succeeded — the job finished, the key was created, the
 * password changed — so a dead relay must not roll that work back. `send` therefore
 * resolves with `delivered: false` instead of throwing, and records the failure.
 * Callers who genuinely need delivery guarantees should enqueue a retry rather than
 * depend on this call.
 */

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text alternative. Rendered from the template when sent via `messages.ts`. */
  text?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
}

export interface SendMailResult {
  delivered: boolean;
  /** Absent when the mailer is disabled or the send failed. */
  messageId?: string;
  /** Why a send did not happen. `undefined` on success. */
  skipped?: "mail-disabled";
  error?: string;
}

export const mailEnabled = (): boolean => env.MAIL_ENABLED === "true";

let transporter: Transporter | null = null;

/**
 * Lazily built and memoised. Construction is deferred so that importing this module
 * — which `messages.ts` does at load time — never opens a socket in a process that
 * only ever renders, or in tests.
 */
export function createTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === "true",
    // Omit auth entirely for relays that authenticate by IP; passing an empty
    // user/pass makes nodemailer attempt AUTH and get rejected.
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });

  return transporter;
}

/** Drops the memoised transport. Used by tests; also lets a process reconnect. */
export function resetTransporter(): void {
  transporter?.close?.();
  transporter = null;
}

const from = (): string =>
  env.MAIL_FROM_NAME ? `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>` : env.MAIL_FROM_ADDRESS;

/**
 * Checks the SMTP credentials and connection without sending anything.
 *
 * Call it at boot to turn a bad relay config into a startup log line rather than a
 * silent stream of failed notifications. Returns false instead of throwing so it can
 * be used as a health signal.
 */
export async function verify(): Promise<boolean> {
  if (!mailEnabled()) {
    logger.info("mail.verify.skipped", { reason: "MAIL_ENABLED is false" });
    return false;
  }

  try {
    await createTransporter()
      .verify()
      .then(() => {
        logger.info("mail.verify.ok", { host: env.SMTP_HOST, port: env.SMTP_PORT });
      });
    return true;
  } catch (err) {
    logger.error("mail.verify.failed", {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Sends one message. Never throws — see the note at the top of this file.
 *
 * Recipients are logged, message bodies are not: the rendered HTML carries
 * temporary passwords, reset links and invoice detail.
 */
export async function send(options: SendMailOptions): Promise<SendMailResult> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to];

  if (!mailEnabled()) {
    logger.info("mail.send.skipped", {
      reason: "MAIL_ENABLED is false",
      to: recipients.length,
      subject: options.subject,
    });
    return { delivered: false, skipped: "mail-disabled" };
  }

  try {
    const info = await createTransporter().sendMail({
      from: from(),
      to: recipients,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo ?? env.SUPPORT_EMAIL,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    logger.info("mail.send.ok", {
      to: recipients.length,
      subject: options.subject,
      messageId: info.messageId,
    });
    return { delivered: true, messageId: info.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("mail.send.failed", { to: recipients.length, subject: options.subject, error });
    return { delivered: false, error };
  }
}
