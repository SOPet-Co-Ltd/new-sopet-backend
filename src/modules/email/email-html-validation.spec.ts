import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import {
  countContentSlots,
  extractPlaceholderNames,
  hasStrayTripleBraces,
  scanEmailSafeHtml,
  validateContainerHtmlShell,
  validateEmailContentTemplate,
} from './email-html-validation';
import { DEFAULT_CONTAINER_SEED, CONTENT_TEMPLATE_SEEDS } from './email-cms.seed-data';

describe('placeholder extraction', () => {
  it('does not treat the {{{content}}} slot as a double-brace placeholder', () => {
    expect(extractPlaceholderNames('before {{{content}}} after')).toEqual([]);
    expect(countContentSlots('before {{{content}}} after')).toBe(1);
  });

  it('extracts unique double-brace placeholder names', () => {
    expect(extractPlaceholderNames('{{inviteUrl}} hi {{inviteUrl}} {{storeName}}')).toEqual([
      'inviteUrl',
      'storeName',
    ]);
  });

  it('flags stray triple braces that are not the exact content slot', () => {
    expect(hasStrayTripleBraces('{{{contentx}}}')).toBe(true);
    expect(hasStrayTripleBraces('{{{content}}} and {{{oops}}}')).toBe(true);
    expect(hasStrayTripleBraces('{{{content}}}')).toBe(false);
  });
});

describe('scanEmailSafeHtml', () => {
  it.each([
    ['<script>alert(1)</script>', '<script'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['<iframe src="x"></iframe>', 'iframe'],
    ['<object data="x"></object>', 'object'],
    ['<embed src="x">', 'embed'],
    ['<form action="x"></form>', 'form'],
    ['<img src="x" onerror="alert(1)">', 'onerror'],
    ['<link rel="stylesheet" href="x">', 'link'],
  ])('blocks %s', (html) => {
    const { blocked } = scanEmailSafeHtml(html);
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('does not block safe table-based email markup', () => {
    const { blocked } = scanEmailSafeHtml(
      '<table><tr><td style="color:#000">Hello <strong>world</strong></td></tr></table>',
    );
    expect(blocked).toEqual([]);
  });

  it('warns (does not block) on flex/grid, video/audio, and @import', () => {
    expect(scanEmailSafeHtml('<div style="display:flex">x</div>').warnings.length).toBeGreaterThan(
      0,
    );
    expect(scanEmailSafeHtml('<video src="x"></video>').warnings.length).toBeGreaterThan(0);
    expect(scanEmailSafeHtml('<style>@import url(x.css);</style>').warnings.length).toBeGreaterThan(
      0,
    );
  });
});

describe('validateContainerHtmlShell', () => {
  it('accepts the seeded default container shell with zero errors', () => {
    const { errors } = validateContainerHtmlShell(DEFAULT_CONTAINER_SEED.htmlShell);
    expect(errors).toEqual([]);
  });

  it('rejects a shell missing the {{{content}}} slot', () => {
    const { errors } = validateContainerHtmlShell('<html><body>no slot here</body></html>');
    expect(errors.some((e) => e.code === 'EMAIL_CONTAINER_SLOT_INVALID')).toBe(true);
  });

  it('rejects a shell with two {{{content}}} slots', () => {
    const { errors } = validateContainerHtmlShell('{{{content}}} and {{{content}}}');
    expect(errors.some((e) => e.code === 'EMAIL_CONTAINER_SLOT_INVALID')).toBe(true);
  });

  it('rejects unknown placeholders in the shell', () => {
    const { errors } = validateContainerHtmlShell('{{{content}}} {{unknownVar}}');
    expect(errors.some((e) => e.code === 'EMAIL_UNKNOWN_PLACEHOLDERS')).toBe(true);
  });

  it('rejects blocked HTML constructs', () => {
    const { errors } = validateContainerHtmlShell('{{{content}}} <script>alert(1)</script>');
    expect(errors.some((e) => e.code === 'EMAIL_HTML_BLOCKED')).toBe(true);
  });
});

describe('validateEmailContentTemplate', () => {
  it.each(CONTENT_TEMPLATE_SEEDS)('accepts the seeded $key content with zero errors', (seed) => {
    const { errors } = validateEmailContentTemplate(seed.key, {
      subjectTemplate: seed.subjectTemplate,
      bodyHtml: seed.bodyHtml,
      textTemplate: seed.textTemplate,
    });
    expect(errors).toEqual([]);
  });

  it('rejects unknown placeholders not in the key registry', () => {
    const { errors } = validateEmailContentTemplate(EmailTemplateKey.PASSWORD_RESET, {
      subjectTemplate: 'Subject {{unknownVar}}',
      bodyHtml: '<p>{{resetUrl}}</p>',
    });
    expect(errors.some((e) => e.code === 'EMAIL_UNKNOWN_PLACEHOLDERS')).toBe(true);
  });

  it('rejects a {{{content}}} slot inside a content body', () => {
    const { errors } = validateEmailContentTemplate(EmailTemplateKey.PASSWORD_RESET, {
      subjectTemplate: 'Subject',
      bodyHtml: '<p>{{{content}}}</p>',
    });
    expect(errors.some((e) => e.code === 'EMAIL_CONTAINER_SLOT_INVALID')).toBe(true);
  });

  it('rejects blocked HTML in the body', () => {
    const { errors } = validateEmailContentTemplate(EmailTemplateKey.PASSWORD_RESET, {
      subjectTemplate: 'Subject',
      bodyHtml: '<p onclick="hack()">{{resetUrl}}</p>',
    });
    expect(errors.some((e) => e.code === 'EMAIL_HTML_BLOCKED')).toBe(true);
  });
});
