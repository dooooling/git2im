/**
 * Route 路由规则管理 REST API 控制器 (Routes Controller)
 */

import type { RouteHandler } from "../http/router";
import { jsonSuccess, jsonError } from "../http/response";
import {
  listRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
  type CreateRouteInput,
  type UpdateRouteInput,
} from "../config/routes";

/**
 * GET /api/routes
 */
export const handleListRoutes: RouteHandler = async (_req, env) => {
  const routes = await listRoutes(env.DB);
  return jsonSuccess(routes);
};

/**
 * POST /api/routes
 */
export const handleCreateRoute: RouteHandler = async (request, env) => {
  let body: CreateRouteInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Invalid JSON payload", 400);
  }

  try {
    const created = await createRoute(env.DB, body);
    return jsonSuccess(created, 201);
  } catch (err: any) {
    return jsonError("ROUTE_CREATE_ERROR", err.message || "Failed to create route", 400);
  }
};

/**
 * GET /api/routes/:id
 */
export const handleGetRoute: RouteHandler = async (_req, env, params) => {
  const routeId = params.id;
  if (!routeId) {
    return jsonError("BAD_REQUEST", "Route ID required", 400);
  }

  const route = await getRouteById(env.DB, routeId);
  if (!route) {
    return jsonError("NOT_FOUND", "Route not found", 404);
  }

  return jsonSuccess(route);
};

/**
 * PUT /api/routes/:id
 */
export const handleUpdateRoute: RouteHandler = async (request, env, params) => {
  const routeId = params.id;
  if (!routeId) {
    return jsonError("BAD_REQUEST", "Route ID required", 400);
  }

  let body: UpdateRouteInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Invalid JSON payload", 400);
  }

  try {
    const updated = await updateRoute(env.DB, routeId, body);
    return jsonSuccess(updated);
  } catch (err: any) {
    return jsonError("ROUTE_UPDATE_ERROR", err.message || "Failed to update route", 400);
  }
};

/**
 * DELETE /api/routes/:id
 */
export const handleDeleteRoute: RouteHandler = async (_req, env, params) => {
  const routeId = params.id;
  if (!routeId) {
    return jsonError("BAD_REQUEST", "Route ID required", 400);
  }

  try {
    await deleteRoute(env.DB, routeId);
    return jsonSuccess({ message: "Route deleted successfully" });
  } catch (err: any) {
    return jsonError("ROUTE_DELETE_ERROR", err.message || "Failed to delete route", 400);
  }
};
