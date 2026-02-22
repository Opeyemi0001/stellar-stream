import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerDocument } from "./swagger";
import { fetchOpenIssues } from "./services/openIssues";
import {
  calculateProgress,
  cancelStream,
  createStream,
  getStream,
  listStreams,
  initSoroban,
  syncStreams,
  updateStreamStartAt,
  StreamInput,
  StreamStatus,
} from "./services/streamStore";

const STREAM_STATUSES: StreamStatus[] = ["scheduled", "active", "completed", "canceled"];
const PAGINATION_DEFAULT_PAGE = 1;
const PAGINATION_DEFAULT_LIMIT = 20;
const PAGINATION_MAX_LIMIT = 100;

export const app = express();
const port = Number(process.env.PORT ?? 3001);
const ALLOWED_ASSETS = (process.env.ALLOWED_ASSETS || 'USDC,XLM')
  .split(',')
  .map(a => a.trim().toUpperCase());

app.use(cors());
app.use(express.json());

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseOptionalQueryString(
  value: unknown,
  fieldName: string,
): { ok: true; value?: string } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }

  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string") {
    return { ok: false, message: `${fieldName} must be a string.` };
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { ok: false, message: `${fieldName} must be a non-empty string.` };
  }

  return { ok: true, value: trimmed };
}

function parseOptionalPositiveIntQuery(
  value: unknown,
  fieldName: string,
  min: number,
  max?: number,
): { ok: true; value?: number } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }

  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = toNumber(rawValue);
  if (parsed === null || !Number.isInteger(parsed)) {
    return { ok: false, message: `${fieldName} must be an integer.` };
  }

  if (parsed < min) {
    return { ok: false, message: `${fieldName} must be greater than or equal to ${min}.` };
  }

  if (max !== undefined && parsed > max) {
    return { ok: false, message: `${fieldName} must be less than or equal to ${max}.` };
  }

  return { ok: true, value: parsed };
}

function parseOptionalStatusQuery(
  value: unknown,
): { ok: true; value?: StreamStatus } | { ok: false; message: string } {
  const parsed = parseOptionalQueryString(value, "status");
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value === undefined) {
    return { ok: true };
  }

  const normalized = parsed.value.toLowerCase();
  if (!STREAM_STATUSES.includes(normalized as StreamStatus)) {
    return {
      ok: false,
      message: `status must be one of: ${STREAM_STATUSES.join(", ")}.`,
    };
  }

  return { ok: true, value: normalized as StreamStatus };
}

function parseInput(body: unknown): { ok: true; value: StreamInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Body must be a JSON object." };
  }

  const payload = body as Record<string, unknown>;
  const sender = typeof payload.sender === "string" ? payload.sender.trim() : "";
  const recipient = typeof payload.recipient === "string" ? payload.recipient.trim() : "";
  const assetCodeRaw = typeof payload.assetCode === "string" ? payload.assetCode.trim() : "";
  const totalAmount = toNumber(payload.totalAmount);
  const durationSeconds = toNumber(payload.durationSeconds);
  const startAtValue = payload.startAt === undefined ? null : toNumber(payload.startAt);
  const assetCodeUpper = assetCodeRaw.toUpperCase();

  if (sender.length < 5 || recipient.length < 5) {
    return { ok: false, message: "Sender and recipient must look like valid Stellar account IDs." };
  }

  if (assetCodeRaw.length < 2 || assetCodeRaw.length > 12) {
    return { ok: false, message: "assetCode must be between 2 and 12 characters." };
  }

  // whitelist check
  if (!ALLOWED_ASSETS.includes(assetCodeUpper)) {
    return {
      ok: false,
      message: `Asset "${assetCodeRaw}" is not supported. Allowed assets: ${ALLOWED_ASSETS.join(', ')}.`,
    };
  }

  if (totalAmount === null || totalAmount <= 0) {
    return { ok: false, message: "totalAmount must be a positive number." };
  }

  if (durationSeconds === null || durationSeconds < 60) {
    return { ok: false, message: "durationSeconds must be at least 60 seconds." };
  }

  if (startAtValue !== null && startAtValue <= 0) {
    return { ok: false, message: "startAt must be a valid UNIX timestamp in seconds." };
  }

  return {
    ok: true,
    value: {
      sender,
      recipient,
      assetCode: assetCodeRaw.toUpperCase(),
      totalAmount,
      durationSeconds: Math.floor(durationSeconds),
      startAt: startAtValue === null ? undefined : Math.floor(startAtValue),
    },
  };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-stream-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/streams", (req: Request, res: Response) => {
  const senderQuery = parseOptionalQueryString(req.query.sender, "sender");
  if (!senderQuery.ok) {
    res.status(400).json({ error: senderQuery.message });
    return;
  }

  const recipientQuery = parseOptionalQueryString(req.query.recipient, "recipient");
  if (!recipientQuery.ok) {
    res.status(400).json({ error: recipientQuery.message });
    return;
  }

  const statusQuery = parseOptionalStatusQuery(req.query.status);
  if (!statusQuery.ok) {
    res.status(400).json({ error: statusQuery.message });
    return;
  }

  const pageQuery = parseOptionalPositiveIntQuery(req.query.page, "page", 1);
  if (!pageQuery.ok) {
    res.status(400).json({ error: pageQuery.message });
    return;
  }

  const limitQuery = parseOptionalPositiveIntQuery(req.query.limit, "limit", 1, PAGINATION_MAX_LIMIT);
  if (!limitQuery.ok) {
    res.status(400).json({ error: limitQuery.message });
    return;
  }

  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined;

  let streams = listStreams();
  if (senderQuery.value !== undefined) {
    streams = streams.filter((stream) => stream.sender === senderQuery.value);
  }
  if (recipientQuery.value !== undefined) {
    streams = streams.filter((stream) => stream.recipient === recipientQuery.value);
  }

  let data = streams.map((stream) => ({ ...stream, progress: calculateProgress(stream) }));
  if (statusQuery.value !== undefined) {
    data = data.filter((stream) => stream.progress.status === statusQuery.value);
  }

  const total = data.length;

  const page = paginationRequested ? (pageQuery.value ?? PAGINATION_DEFAULT_PAGE) : 1;
  const limit = paginationRequested
    ? (limitQuery.value ?? PAGINATION_DEFAULT_LIMIT)
    : (total === 0 ? 0 : total);

  if (paginationRequested) {
    const start = (page - 1) * limit;
    data = data.slice(start, start + limit);
  }

  res.json({ data, total, page, limit });
});

app.get("/api/streams/:id", (req: Request, res: Response) => {
  const stream = getStream(req.params.id);
  if (!stream) { res.status(404).json({ error: "Stream not found." }); return; }
  res.json({ data: { ...stream, progress: calculateProgress(stream) } });
});

app.post("/api/streams", async (req: Request, res: Response) => {
  const parsed = parseInput(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.message }); return; }

  try {
    const stream = await createStream(parsed.value);
    res.status(201).json({ data: { ...stream, progress: calculateProgress(stream) } });
  } catch (err: any) {
    console.error("Failed to create stream:", err);
    res.status(500).json({ error: err.message || "Failed to create stream." });
  }
});

app.post("/api/streams/:id/cancel", async (req: Request, res: Response) => {
  try {
    const stream = await cancelStream(req.params.id);
    if (!stream) { res.status(404).json({ error: "Stream not found." }); return; }
    res.json({ data: { ...stream, progress: calculateProgress(stream) } });
  } catch (err: any) {
    console.error("Failed to cancel stream:", err);
    res.status(500).json({ error: err.message || "Failed to cancel stream." });
  }
});

app.patch("/api/streams/:id/start-time", (req: Request, res: Response) => {
  const newStartAt = toNumber(req.body?.startAt);

  if (newStartAt === null || newStartAt <= 0) {
    res.status(400).json({ error: "startAt must be a valid UNIX timestamp in seconds." });
    return;
  }

  if (Math.floor(newStartAt) <= Math.floor(Date.now() / 1000)) {
    res.status(400).json({ error: "startAt must be in the future." });
    return;
  }

  try {
    const stream = updateStreamStartAt(req.params.id, Math.floor(newStartAt));
    res.json({
      data: {
        ...stream,
        progress: calculateProgress(stream),
      },
    });
  } catch (err: any) {
    const statusCode = (err as any).statusCode ?? 500;
    res.status(statusCode).json({ error: err.message || "Failed to update stream start time." });
  }
});

app.get("/api/open-issues", async (_req: Request, res: Response) => {
  try {
    const data = await fetchOpenIssues();
    res.json({ data });
  } catch (err: any) {
    console.error("Failed to fetch open issues from proxy:", err);
    res.status(500).json({ error: err.message || "Failed to fetch open issues." });
  }
});



export async function startServer() {
  await initSoroban();
  await syncStreams();
  app.listen(port, () => {
    console.log(`StellarStream API listening on http://localhost:${port}`);

  });
}

if (require.main === module) {
  startServer().catch(console.error);
}
