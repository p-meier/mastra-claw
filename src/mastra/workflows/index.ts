import 'server-only';

import { customWorkflows } from './custom';
import { platformWorkflows } from './platform';

/**
 * Union of platform and fork workflows. Fork entries shadow platform
 * entries when the keys collide.
 */
export const allWorkflows = { ...platformWorkflows, ...customWorkflows };
