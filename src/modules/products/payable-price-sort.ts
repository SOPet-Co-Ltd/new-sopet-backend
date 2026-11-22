/**
 * Payable card price used by price sort.
 * Matches the storefront card: cheapest positive variant price (else base price),
 * then the winning active sale-campaign percent on that variant.
 */
export function payablePriceSortExpression(alias: string): string {
  const catalogPrice = `COALESCE(
    (
      SELECT MIN(${alias}.base_price + variant.price_adjustment)
      FROM product_variants variant
      WHERE variant.product_id = ${alias}.id
        AND variant.deleted_at IS NULL
        AND (${alias}.base_price + variant.price_adjustment) > 0
    ),
    ${alias}.base_price
  )`;

  const cheapestVariantId = `(
    SELECT variant.id
    FROM product_variants variant
    WHERE variant.product_id = ${alias}.id
      AND variant.deleted_at IS NULL
      AND (${alias}.base_price + variant.price_adjustment) > 0
    ORDER BY (${alias}.base_price + variant.price_adjustment) ASC, variant.id ASC
    LIMIT 1
  )`;

  return `(
    SELECT CASE
      WHEN winner.discount_percent BETWEEN 1 AND 99 AND catalog.price > 0
      THEN ROUND(CAST(catalog.price * (1 - winner.discount_percent / 100.0) AS numeric), 2)
      ELSE catalog.price
    END
    FROM (SELECT ${catalogPrice} AS price) catalog
    LEFT JOIN LATERAL (
      SELECT item.discount_percent
      FROM sale_campaign_items item
      INNER JOIN sale_campaigns campaign ON campaign.id = item.campaign_id
      WHERE item.product_id = ${alias}.id
        AND campaign.is_active = true
        AND campaign.deleted_at IS NULL
        AND (campaign.starts_at IS NULL OR campaign.starts_at <= NOW())
        AND (campaign.expires_at IS NULL OR campaign.expires_at >= NOW())
        AND (
          item.variant_id IS NULL
          OR item.variant_id = ${cheapestVariantId}
        )
      ORDER BY
        CASE WHEN item.variant_id IS NOT NULL THEN 0 ELSE 1 END,
        campaign.priority DESC,
        campaign.created_at DESC
      LIMIT 1
    ) winner ON TRUE
  )`;
}
