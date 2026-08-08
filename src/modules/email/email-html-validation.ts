import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import { getContainerSystemPlaceholders, getPlaceholdersForKey } from './email-template-registry';

/**
 * Matches the literal `{{{content}}}` slot marker (triple braces). Kept
 * separate from `DOUBLE_VAR_REGEX` — the slot is not a `{{var}}` placeholder.
 */
export const CONTENT_SLOT_REGEX = /\{\{\{\s*content\s*\}\}\}/g;

/**
 * Matches `{{name}}` double-brace placeholders while excluding the
 * `{{{content}}}` triple-brace slot (negative lookahead after the opening
 * `{{` and negative lookahead after the closing `}}` reject any brace that is
 * actually part of a triple-brace run). Reused for both unknown-placeholder
 * detection and merge-time substitution so both stay in sync.
 */
export const DOUBLE_VAR_REGEX = /\{\{(?!\{)\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}(?!\})/g;

const MAX_FIELD_BYTES = 200 * 1024; // reject
const WARN_HTML_BYTES = 100 * 1024; // warn (Gmail clipping)

export interface EmailValidationError {
  code: string;
  message: string;
}

export function countContentSlots(html: string): number {
  return (html.match(CONTENT_SLOT_REGEX) ?? []).length;
}

export function hasStrayTripleBraces(html: string): boolean {
  const withoutSlots = html.replace(CONTENT_SLOT_REGEX, '');
  return /\{\{\{|\}\}\}/.test(withoutSlots);
}

export function extractPlaceholderNames(text: string): string[] {
  const names = new Set<string>();
  const regex = new RegExp(DOUBLE_VAR_REGEX);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    names.add(match[1]);
  }
  return [...names];
}

export interface EmailHtmlScanResult {
  blocked: string[];
  warnings: string[];
}

const SCRIPT_REGEX = /<script\b/i;
const JAVASCRIPT_URL_REGEX = /(href|src)\s*=\s*["']?\s*javascript:/i;
const IFRAME_REGEX = /<iframe\b/i;
const OBJECT_REGEX = /<object\b/i;
const EMBED_REGEX = /<embed\b/i;
const FORM_REGEX = /<form\b/i;
const EVENT_HANDLER_REGEX = /\son[a-z]+\s*=/i;
const LINK_REL_REGEX = /<link\b[^>]*\brel\s*=/i;

const FLEX_GRID_REGEX = /display\s*:\s*(flex|grid)/i;
const VIDEO_AUDIO_REGEX = /<(video|audio)\b/i;
const STYLE_IMPORT_REGEX = /<style\b[^>]*>[\s\S]*?@import/i;

/** Email-safe HTML block/warn scan (Design Doc § Email-safe HTML Validation Rules). */
export function scanEmailSafeHtml(html: string): EmailHtmlScanResult {
  const blocked: string[] = [];
  const warnings: string[] = [];

  if (SCRIPT_REGEX.test(html)) blocked.push('<script> tags are not allowed');
  if (JAVASCRIPT_URL_REGEX.test(html)) blocked.push('javascript: URLs are not allowed');
  if (IFRAME_REGEX.test(html)) blocked.push('<iframe> tags are not allowed');
  if (OBJECT_REGEX.test(html)) blocked.push('<object> tags are not allowed');
  if (EMBED_REGEX.test(html)) blocked.push('<embed> tags are not allowed');
  if (FORM_REGEX.test(html)) blocked.push('<form> tags are not allowed');
  if (EVENT_HANDLER_REGEX.test(html))
    blocked.push('inline on* event handler attributes are not allowed');
  if (LINK_REL_REGEX.test(html))
    blocked.push('external stylesheet <link rel=...> tags are not allowed');

  if (FLEX_GRID_REGEX.test(html)) {
    warnings.push('display:flex/grid has weak email client support');
  }
  if (VIDEO_AUDIO_REGEX.test(html)) {
    warnings.push('<video>/<audio> tags are often stripped by email clients');
  }
  if (STYLE_IMPORT_REGEX.test(html)) {
    warnings.push('@import inside <style> blocks is unreliable across email clients');
  }
  if (Buffer.byteLength(html, 'utf8') > WARN_HTML_BYTES) {
    warnings.push('HTML exceeds 100KB and may be clipped by some inbox providers (e.g. Gmail)');
  }

  return { blocked, warnings };
}

function tooLarge(text: string): boolean {
  return Buffer.byteLength(text, 'utf8') > MAX_FIELD_BYTES;
}

/** Validate a container's `htmlShell` on save. */
export function validateContainerHtmlShell(htmlShell: string): {
  errors: EmailValidationError[];
  warnings: string[];
} {
  const errors: EmailValidationError[] = [];

  const slotCount = countContentSlots(htmlShell);
  if (slotCount !== 1) {
    errors.push({
      code: 'EMAIL_CONTAINER_SLOT_INVALID',
      message: `Container htmlShell must contain exactly one {{{content}}} slot (found ${slotCount})`,
    });
  } else if (hasStrayTripleBraces(htmlShell)) {
    errors.push({
      code: 'EMAIL_CONTAINER_SLOT_INVALID',
      message: 'Container htmlShell contains invalid triple-brace syntax other than {{{content}}}',
    });
  }

  const { blocked, warnings } = scanEmailSafeHtml(htmlShell);
  if (blocked.length > 0) {
    errors.push({
      code: 'EMAIL_HTML_BLOCKED',
      message: `Blocked HTML constructs: ${blocked.join('; ')}`,
    });
  }

  const allowedNames = new Set(getContainerSystemPlaceholders().map((p) => p.name));
  const unknown = extractPlaceholderNames(htmlShell.replace(CONTENT_SLOT_REGEX, '')).filter(
    (name) => !allowedNames.has(name),
  );
  if (unknown.length > 0) {
    errors.push({
      code: 'EMAIL_UNKNOWN_PLACEHOLDERS',
      message: `Unknown placeholders: ${unknown.join(', ')}`,
    });
  }

  if (tooLarge(htmlShell)) {
    errors.push({
      code: 'EMAIL_HTML_BLOCKED',
      message: 'htmlShell exceeds the maximum allowed size (200KB)',
    });
  }

  return { errors, warnings };
}

export interface EmailContentTemplateFields {
  subjectTemplate: string;
  bodyHtml: string;
  textTemplate?: string;
}

/** Validate a content template's subject/body/text on save (Design Doc § Email-safe HTML Validation Rules). */
export function validateEmailContentTemplate(
  key: EmailTemplateKey,
  fields: EmailContentTemplateFields,
): { errors: EmailValidationError[]; warnings: string[] } {
  const errors: EmailValidationError[] = [];
  const allowedNames = new Set(getPlaceholdersForKey(key).map((p) => p.name));

  if (countContentSlots(fields.bodyHtml) > 0 || hasStrayTripleBraces(fields.bodyHtml)) {
    errors.push({
      code: 'EMAIL_CONTAINER_SLOT_INVALID',
      message: 'Content bodyHtml must not contain a {{{content}}} slot',
    });
  }

  const { blocked, warnings } = scanEmailSafeHtml(fields.bodyHtml);
  if (blocked.length > 0) {
    errors.push({
      code: 'EMAIL_HTML_BLOCKED',
      message: `Blocked HTML constructs: ${blocked.join('; ')}`,
    });
  }

  const fieldsToScan: Array<[string, string]> = [
    ['subject', fields.subjectTemplate],
    ['body', fields.bodyHtml],
    ...(fields.textTemplate ? ([['text', fields.textTemplate]] as Array<[string, string]>) : []),
  ];

  const unknownSet = new Set<string>();
  for (const [, text] of fieldsToScan) {
    for (const name of extractPlaceholderNames(text)) {
      if (!allowedNames.has(name)) unknownSet.add(name);
    }
  }
  if (unknownSet.size > 0) {
    errors.push({
      code: 'EMAIL_UNKNOWN_PLACEHOLDERS',
      message: `Unknown placeholders: ${[...unknownSet].join(', ')}`,
    });
  }

  for (const [, text] of fieldsToScan) {
    if (tooLarge(text)) {
      errors.push({
        code: 'EMAIL_HTML_BLOCKED',
        message: 'Field exceeds the maximum allowed size (200KB)',
      });
      break;
    }
  }

  if (fields.subjectTemplate.length > 998) {
    warnings.push('Subject exceeds the recommended 998 character length');
  }

  return { errors, warnings };
}
