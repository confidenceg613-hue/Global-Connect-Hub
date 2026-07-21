import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

app.use("/api", router);

// JSON 404 for unmatched /api routes (Express default returns HTML)
app.use("/api", (_req: Request, res: Response): void => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — catches sync throws and async rejections forwarded by
// Express 5 (which auto-calls next(err) for rejected async route handlers).
// Must be defined after all routes and have exactly 4 parameters.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  const status =
    typeof err === "object" && err !== null
      ? ((err as Record<string, unknown>).status as number) ??
        ((err as Record<string, unknown>).statusCode as number) ??
        500
      : 500;
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as Record<string, unknown>).message)
      : "Internal server error";

  if (status >= 500) {
    logger.error(err, "Unhandled route error");
  }

  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

export default app;
