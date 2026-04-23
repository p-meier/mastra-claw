import 'server-only';

import { customTools } from './custom';
import { platformTools } from './platform';

/**
 * Union of platform and fork tools. Fork entries shadow platform
 * entries when the keys collide.
 */
export const allTools = { ...platformTools, ...customTools };
