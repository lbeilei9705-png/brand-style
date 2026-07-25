import type { ServerResponse } from "http";

export function send(res: ServerResponse, statusCode: number, body: string | Buffer, contentType = "application/json; charset=utf-8"): void {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-brand-style-token, x-client-session-id, x-client-request-id",
    "Access-Control-Expose-Headers": "x-request-id, x-issue-id, Retry-After",
    "Content-Type": contentType,
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  send(res, statusCode, JSON.stringify(payload));
}
