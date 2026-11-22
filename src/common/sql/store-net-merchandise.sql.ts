import { PromotionScope, PromotionType } from '../../database/entities/promotion.entity';

const SHIPPING_PROMOTION_TYPES = [
  PromotionType.FREE_SHIPPING,
  PromotionType.FIXED_SHIPPING_DISCOUNT,
  PromotionType.PERCENTAGE_SHIPPING_DISCOUNT,
] as const;

/**
 * Store merchandise after item coupons and promotions, for the same orders the
 * surrounding summary already filters. Shipping promotions stay on the shipping
 * fee. A store coupon applies to that store; a platform coupon is split by the
 * store's share of the order subtotal.
 */
export function storeNetMerchandiseSql(): string {
  const shippingTypes = SHIPPING_PROMOTION_TYPES.map((type) => `'${type}'`).join(', ');
  const itemDiscount = `promo.type NOT IN (${shippingTypes})`;

  return `(
    SELECT COALESCE(SUM(
      GREATEST(
        0,
        line.store_subtotal - LEAST(
          line.store_subtotal,
          CASE
            WHEN line.has_usage THEN
              COALESCE(store_discount.amount, 0)
              + CASE
                  WHEN line.order_subtotal > 0
                    THEN COALESCE(platform_discount.amount, 0) * line.store_subtotal / line.order_subtotal
                  ELSE 0
                END
            ELSE CASE
              WHEN line.order_subtotal > 0
                THEN line.discount_amount * line.store_subtotal / line.order_subtotal
              ELSE 0
            END
          END
        )
      )
    ), 0)
    FROM (
      SELECT
        item.order_id,
        SUM(item.subtotal) AS store_subtotal,
        ord.subtotal AS order_subtotal,
        COALESCE(ord.discount_amount, 0) AS discount_amount,
        EXISTS (
          SELECT 1 FROM promotion_usages usage_exists
          WHERE usage_exists.order_id = item.order_id
        ) AS has_usage
      FROM order_items item
      INNER JOIN orders ord ON ord.id = item.order_id
      WHERE item.store_id = :storeId
        AND ord.status NOT IN (:...excludedStatuses)
        AND ord.created_at >= :monthFrom
        AND ord.created_at <= :monthTo
      GROUP BY item.order_id, ord.subtotal, ord.discount_amount
    ) line
    LEFT JOIN (
      SELECT usage.order_id, SUM(usage.discount_amount) AS amount
      FROM promotion_usages usage
      INNER JOIN promotions promo ON promo.id = usage.promotion_id
      WHERE promo.scope = '${PromotionScope.STORE}'
        AND promo.store_id = :storeId
        AND ${itemDiscount}
      GROUP BY usage.order_id
    ) store_discount ON store_discount.order_id = line.order_id
    LEFT JOIN (
      SELECT usage.order_id, SUM(usage.discount_amount) AS amount
      FROM promotion_usages usage
      INNER JOIN promotions promo ON promo.id = usage.promotion_id
      WHERE promo.scope = '${PromotionScope.PLATFORM}'
        AND ${itemDiscount}
      GROUP BY usage.order_id
    ) platform_discount ON platform_discount.order_id = line.order_id
  )`;
}
