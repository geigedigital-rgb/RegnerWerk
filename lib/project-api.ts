import type { SavedPlotProject } from "@/lib/project-storage";
import { getCalcHistory } from "@/lib/planner/calcLog";

/**
 * Browser talks to this app only. Server routes proxy to the admin backend
 * so CORS on Railway cannot block submit / PDF.
 */
const API_URL = "";

export type ServerProject = {
  id: string;
  status: string;
  place_id: string;
  place_label: string;
  customer_email: string | null;
  customer_name: string | null;
  payload: SavedPlotProject;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
};

function headers(): HeadersInit {
  return { "Content-Type": "application/json" };
}

export async function fetchServerProject(
  id: string,
): Promise<ServerProject | null> {
  const res = await fetch(`${API_URL}/api/projects/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Projekt laden fehlgeschlagen");
  return data.project as ServerProject;
}

export async function submitProject(opts: {
  payload: SavedPlotProject;
  customerEmail?: string;
  customerName?: string;
  projectId?: string;
}): Promise<{ id: string; status: string }> {
  const res = await fetch(`${API_URL}/api/projects/submit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      payload: {
        ...opts.payload,
        sofortPlan: opts.payload.sofortPlan,
        plotStage: "ergebnis",
        calcHistory: getCalcHistory(),
      },
      customerEmail: opts.customerEmail || "",
      customerName: opts.customerName || "",
      projectId: opts.projectId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Speichern fehlgeschlagen");
  }
  return { id: data.id as string, status: data.status as string };
}

/** Generate (and usually persist) PDF; triggers browser download. */
export async function downloadProjectPdf(opts: {
  payload: SavedPlotProject;
  projectId?: string;
  customerEmail?: string;
  customerName?: string;
}): Promise<{ projectId: string | null }> {
  if (!opts.payload.sofortPlan) {
    throw new Error("Kein Sofort-Plan vorhanden");
  }

  const res = await fetch(`${API_URL}/api/projects/pdf`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      payload: {
        ...opts.payload,
        plotStage: "ergebnis",
      },
      projectId: opts.projectId,
      customerEmail: opts.customerEmail || "",
      customerName: opts.customerName || "",
      persist: true,
    }),
  });

  if (!res.ok) {
    let msg = "PDF fehlgeschlagen";
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const projectId = res.headers.get("X-Project-Id") || opts.projectId || null;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `RegnerWerk-Plan${projectId ? `-${projectId.slice(0, 8)}` : ""}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { projectId };
}

export async function downloadStoredPdf(projectId: string): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/projects/${encodeURIComponent(projectId)}/pdf`,
  );
  if (!res.ok) throw new Error("PDF laden fehlgeschlagen");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `RegnerWerk-${projectId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
