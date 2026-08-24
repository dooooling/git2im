/**
 * 极轻量原生 HTTP 路由模块 (Native HTTP Router)
 *
 * 核心设计：
 * 1. 严格遵守“禁止引入外部 Web 框架”约束，基于标准 Web API 手写实现。
 * 2. 支持 GET, POST, PUT, DELETE 方法匹配与动态路径参数提取 (如 /api/targets/:id)。
 */

import type { Env } from "../env";

export type RouteHandler = (
  request: Request,
  env: Env,
  params: Record<string, string>,
  ctx: ExecutionContext
) => Promise<Response>;

interface RouteEntry {
  method: string;
  pattern: string;
  keys: string[];
  regex: RegExp;
  handler: RouteHandler;
}

export class Router {
  private routes: RouteEntry[] = [];

  /**
   * 将路径模式 (如 /api/targets/:id) 编译为正则表达式与参数键名
   */
  private compilePattern(pattern: string): { regex: RegExp; keys: string[] } {
    const keys: string[] = [];
    const normalized = pattern.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });

    const regex = new RegExp(`^${normalized}$`);
    return { regex, keys };
  }

  public add(method: string, pattern: string, handler: RouteHandler): void {
    const { regex, keys } = this.compilePattern(pattern);
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      keys,
      regex,
      handler,
    });
  }

  public get(pattern: string, handler: RouteHandler): void {
    this.add("GET", pattern, handler);
  }

  public post(pattern: string, handler: RouteHandler): void {
    this.add("POST", pattern, handler);
  }

  public put(pattern: string, handler: RouteHandler): void {
    this.add("PUT", pattern, handler);
  }

  public delete(pattern: string, handler: RouteHandler): void {
    this.add("DELETE", pattern, handler);
  }

  /**
   * 匹配请求并执行对应的路由处理器
   *
   * @returns 若命中路由返回 Promise<Response>，未命中返回 null
   */
  public async handle(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response | null> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const match = pathname.match(route.regex);
      if (match) {
        const params: Record<string, string> = {};
        for (let i = 0; i < route.keys.length; i++) {
          const key = route.keys[i];
          const val = match[i + 1];
          if (key && val !== undefined) {
            params[key] = decodeURIComponent(val);
          }
        }

        return await route.handler(request, env, params, ctx);
      }
    }

    return null;
  }
}
