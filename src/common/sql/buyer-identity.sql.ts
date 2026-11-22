/**
 * Thai phone stored on a guest order, normalized to local `0xxxxxxxxx` when the
 * digits are a Thai mobile number. Other values stay trimmed so they still group.
 */
export function normalizedGuestPhoneSql(phoneExpr: string): string {
  const digits = `regexp_replace(BTRIM(${phoneExpr}), '\\D', '', 'g')`;
  return `(
    CASE
      WHEN ${digits} ~ '^660[0-9]{9}' THEN '0' || SUBSTRING(${digits} FROM 4 FOR 9)
      WHEN ${digits} ~ '^66[0-9]{9}' THEN '0' || SUBSTRING(${digits} FROM 3 FOR 9)
      WHEN ${digits} ~ '^0[0-9]{9}' THEN SUBSTRING(${digits} FROM 1 FOR 10)
      WHEN ${digits} ~ '^[0-9]{9}$' THEN '0' || ${digits}
      ELSE NULLIF(BTRIM(${phoneExpr}), '')
    END
  )`;
}

/** True when a customer row owns this already-normalized guest phone. */
export function guestPhoneMatchesCustomerSql(phoneKeyExpr: string, customerAlias = 'c'): string {
  return `(
    ${customerAlias}.deleted_at IS NULL
    AND (
      ${customerAlias}.phone = ${phoneKeyExpr}
      OR ${customerAlias}.phone = '+66' || SUBSTRING(${phoneKeyExpr} FROM 2)
    )
  )`;
}

/**
 * One purchaser identity for an order:
 * the account on the order, else the account that already uses this guest phone,
 * else `guest:` plus the normalized phone.
 */
export function orderBuyerKeySql(orderAlias: string): string {
  const phone = normalizedGuestPhoneSql(`${orderAlias}.guest_phone`);
  return `COALESCE(
    ${orderAlias}.customer_id::text,
    (
      SELECT c.id::text
      FROM customers c
      WHERE ${guestPhoneMatchesCustomerSql(phone)}
      ORDER BY c.created_at ASC
      LIMIT 1
    ),
    CASE WHEN ${phone} IS NOT NULL THEN 'guest:' || ${phone} ELSE NULL END
  )`;
}
