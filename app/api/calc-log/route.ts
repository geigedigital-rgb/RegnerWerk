import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CalcLogEntry, CalcLogSnapshot } from "@/lib/planner/calcLog";

const LOG_FILE = path.join(process.cwd(), ".calc-logs.json");
const SNAPSHOT_DIR = path.join(process.cwd(), ".calc-snapshots");
const MAX_ENTRIES = 200;

function devOnly() {
  return process.env.NODE_ENV === "development";
}

async function readLogs(): Promise<CalcLogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CalcLogEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeSnapshot(snapshot: CalcLogSnapshot): Promise<void> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  const payload = JSON.stringify(snapshot, null, 2);
  await Promise.all([
    fs.writeFile(path.join(SNAPSHOT_DIR, "latest.json"), payload, "utf-8"),
    fs.writeFile(
      path.join(SNAPSHOT_DIR, `${snapshot.fingerprint}.json`),
      payload,
      "utf-8",
    ),
    snapshot.placeId
      ? fs.writeFile(
          path.join(SNAPSHOT_DIR, `place-${snapshot.placeId}.json`),
          payload,
          "utf-8",
        )
      : Promise.resolve(),
  ]);
}

/** GET /api/calc-log — list logs (?latest=1 | ?limit=N) or snapshot (?snapshot=latest|fingerprint) */
export async function GET(req: NextRequest) {
  if (!devOnly()) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const snapshotKey = req.nextUrl.searchParams.get("snapshot");
  if (snapshotKey) {
    const file =
      snapshotKey === "latest"
        ? path.join(SNAPSHOT_DIR, "latest.json")
        : snapshotKey.startsWith("place-")
          ? path.join(SNAPSHOT_DIR, `${snapshotKey}.json`)
          : path.join(SNAPSHOT_DIR, `${snapshotKey}.json`);
    try {
      const raw = await fs.readFile(file, "utf-8");
      return NextResponse.json(JSON.parse(raw));
    } catch {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
  }

  const logs = await readLogs();
  if (req.nextUrl.searchParams.get("latest") === "1") {
    return NextResponse.json(logs.at(-1) ?? null);
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "0");
  if (limit > 0) {
    return NextResponse.json(logs.slice(-limit));
  }
  return NextResponse.json(logs);
}

/** POST /api/calc-log — append entry + optional geometry snapshot for agent replay */
export async function POST(req: NextRequest) {
  if (!devOnly()) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const body = (await req.json()) as {
      entry?: CalcLogEntry;
      snapshot?: CalcLogSnapshot;
    };
    const entry = body.entry ?? (body as unknown as CalcLogEntry);

    const logs = await readLogs();
    logs.push(entry);
    if (logs.length > MAX_ENTRIES) logs.splice(0, logs.length - MAX_ENTRIES);
    await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2), "utf-8");

    if (body.snapshot?.zones?.length) {
      await writeSnapshot(body.snapshot);
    }

    return NextResponse.json({
      ok: true,
      fingerprint: entry.geometry?.fingerprint,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
