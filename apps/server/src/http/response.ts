import type { ServerResponse } from "http";

export function send(res: ServerResponse, statusCode: number, body: string | Buffer, contentType = "application/json; charset=utf-8"): void {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-brand-style-token",
    "Content-Type": contentType,
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  send(res, statusCode, JSON.stringify(payload));
}
