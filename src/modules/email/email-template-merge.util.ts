import { escapeHtml } from './email-templates';
import { CONTENT_SLOT_REGEX, DOUBLE_VAR_REGEX } from './email-html-validation';

export interface SubstituteOptions {
  /** Escape substituted scalar values (HTML body context). Subject/text use false. */
  escapeScalars: boolean;
  /** Placeholder names substituted raw (no escaping) regardless of `escapeScalars`. */
  trustedKeys: Set<string>;
}

/**
 * Merge Algorithm step: DOUBLE substitute `{{name}}` placeholders.
 * `{{{content}}}` (the container slot) is never matched — see `DOUBLE_VAR_REGEX`.
 * Placeholders with no matching var are left untouched (should not occur once
 * save-time unknown-placeholder validation has run).
 */
export function substituteDoubleBraces(
  template: string,
  vars: Record<string, string>,
  options: SubstituteOptions,
): string {
  return template.replace(DOUBLE_VAR_REGEX, (match, name: string) => {
    if (!(name in vars)) {
      return match;
    }
    const value = vars[name];
    if (options.trustedKeys.has(name)) {
      return value;
    }
    return options.escapeScalars ? escapeHtml(value) : value;
  });
}

/** Merge Algorithm step: inject merged body into the container's `{{{content}}}` slot exactly once. */
export function injectContentSlot(htmlShell: string, body: string): string {
  let replaced = false;
  return htmlShell.replace(CONTENT_SLOT_REGEX, () => {
    if (replaced) return '';
    replaced = true;
    return body;
  });
}

/** Fallback plaintext generator when a content template's `textTemplate` is empty. */
export function htmlToPlaintext(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, arr) => line.length > 0 || arr[index - 1]?.length > 0)
    .join('\n')
    .trim();
}
