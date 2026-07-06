import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_STORE_KEY = 'allowSuspendedStore';

// Marks a vendor route as usable even when the active store is suspended
// (account-level actions and store selection/switching flows).
export const AllowSuspendedStore = () => SetMetadata(ALLOW_SUSPENDED_STORE_KEY, true);
