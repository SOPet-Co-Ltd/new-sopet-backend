import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';

/**
 * Deploy gate for Phase 3 / Task 14: published schema must expose Cart.warnings
 * and status fields that can carry on_hold string values for client codegen.
 */
describe('store suspension hold schema deploy gate', () => {
  const schema = readFileSync(join(process.cwd(), 'src/schema.gql'), 'utf8');

  it('publishes Cart.warnings + CartWarningType for suspended-line purge UX', () => {
    expect(schema).toContain('type CartType');
    expect(schema).toMatch(/warnings:\s*\[CartWarningType!\]/);
    expect(schema).toContain('type CartWarningType');
    expect(schema).toContain('code: String!');
    expect(schema).toContain('message: String!');
  });

  it('exposes order/item status as String so on_hold enum values flow to clients', () => {
    expect(schema).toContain('type OrderType');
    expect(schema).toMatch(/type OrderType[\s\S]*?status:\s*String!/);
    expect(schema).toContain('type OrderItemType');
    expect(schema).toMatch(/fulfillmentStatus:\s*String!/);
    expect(OrderStatus.ON_HOLD).toBe('on_hold');
    expect(FulfillmentStatus.ON_HOLD).toBe('on_hold');
  });
});
