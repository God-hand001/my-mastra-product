import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionTier } from './sandbox-runtime';

/**
 * 请求级权限档位作用域(T15)。
 * 每个请求的档位从 requestContext 解析后存入 AsyncLocalStorage，
 * 供 CodexSandbox.currentPolicyOptions() 在命令包裹点读取。
 */
export const requestScope = new AsyncLocalStorage<{ permission?: PermissionTier }>();

/** 读取当前请求作用域的档位;未注入时按 default(fail-closed)处理。 */
export function currentPermissionTier(): PermissionTier {
  return requestScope.getStore()?.permission ?? 'default';
}
