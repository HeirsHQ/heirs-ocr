/**
 * Transactional email. Import the per-template senders from here:
 *
 *     import { sendJobCompleteEmail } from "../notification/mail";
 *
 * `verify()` is worth calling at boot so a bad relay config surfaces as a startup
 * log line rather than as silently undelivered notifications.
 */
export * from "./messages";
export { renderTemplate, placeholdersOf, escapeHtml, htmlToText, TEMPLATE_NAMES } from "./templates";
export type { TemplateName, TemplateValue, TemplateValues, RenderedEmail } from "./templates";
export { send, verify, mailEnabled, createTransporter, resetTransporter } from "./mailer";
export type { SendMailOptions, SendMailResult } from "./mailer";
