/** Extract the real client IP, respecting common proxy headers. */
export function getClientIp(req: import("express").Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  if (Array.isArray(fwd)) return fwd[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}
