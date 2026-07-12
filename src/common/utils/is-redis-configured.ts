/** True when REDIS_HOST is set — enables cache and BullMQ job queues. */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_HOST?.trim());
}
