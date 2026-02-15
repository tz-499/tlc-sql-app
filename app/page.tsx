"use client";

import { useState } from "react";
import { loadCSVAsTablename, runSQL, getSchema, getColumnStats, QueryResult, ColumnInfo, ColumnStats } from "@/lib/engine";

// ---------------------------- L1: Up and Running -----------------------------
export default function Home() {
  // --------------------------- Use State CONSTANTS ---------------------------
  const [status, setStatus] = useState("Idle");
  const [fileName, setFileName] = useState("");
  const [sql, setSql] = useState("SELECT COUNT(*) AS n FROM tablename;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [activeTab, setActiveTab] = useState<"Schema" | "Stats" | "Charts" | "Chat">("Schema");

  const [stats, setStats] = useState<Record<string, ColumnStats>>({});
  const [statsStatus, setStatsStatus] = useState<string>("Not computed");
  const [statsRunning, setStatsRunning] = useState<boolean>(false);

  // ---------------------------- L2: File Upload  -----------------------------
  async function onUpload(file: File) {
    setError(null);
    setResult(null);
    setSchema([]); // Added Schema for Panel Design
    setFileName(file.name);
    setStats({});
    setStatsStatus("Not computed");

    try {
      setStatus("Loading CSV into DuckDB as tablename...");
      await loadCSVAsTablename(file);

      setStatus("Fetching schema...");
      const cols = await getSchema();
      setSchema(cols);

      setStatus("Dataset ready ✅");
    } catch (e: any) {
      setStatus("Failed ❌");
      setError(e?.message ?? String(e));
    }
  }

  // --------------------------- L5: Querying Data -----------------------------
  async function onRun() {
    setError(null);
    setResult(null);

    try {
      setStatus("Running query...");
      const out = await runSQL(sql, 1000);
      setResult(out);
      setStatus(`Done ✅ (${Math.round(out.elapsedMs)} ms)`);
    } catch (e: any) {
      setStatus("Query error ❌");
      setError(e?.message ?? String(e));
    }
  }

  // ----------------------------- L7: Data Stats ------------------------------
  async function computeStats() {
    if (schema.length === 0) return;

    setStatsRunning(true);
    setStats({});
    setStatsStatus(`Computing 0 / ${schema.length}...`);

    try {
      const out: Record<string, ColumnStats> = {};
      for (let i = 0; i < schema.length; i++) {
        const col = schema[i];
        setStatsStatus(`Computing ${i + 1} / ${schema.length}: ${col.name}`);
        const s = await getColumnStats(col.name, col.type);
        out[col.name] = s;
        setStats({ ...out }); // incremental updates so you see progress
      }
      setStatsStatus("Done ✅");
    } catch (e: any) {
      setStatsStatus("Failed ❌");
      setError(e?.message ?? String(e));
    } finally {
      setStatsRunning(false);
    }
  }



  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>CSV SQL Explorer</h1>

      {/* Header row (keep your existing upload/status UI) */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload(f);
          }}
        />
        {fileName && (
          <span>
            Loaded: <b>{fileName}</b>
          </span>
        )}
        <span>
          Status: <b>{status}</b>
        </span>
      </div>

      {/* Body: 2 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "start" }}>
        {/* LEFT: your existing SQL + results */}
        <div style={{ maxWidth: 1100 }}>
          <div>
            <h2>SQL</h2>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={6}
              style={{
                width: "100%",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                padding: 12,
                borderRadius: 8,
                border: "1px solid #ccc",
              }}
            />
            <div style={{ marginTop: 8 }}>
              <button onClick={() => void onRun()} style={{ padding: "8px 12px" }}>
                Run Query
              </button>
              <span style={{ marginLeft: 12, color: "#555" }}>
                (If you don’t write LIMIT, we auto-cap results to 1000 rows)
              </span>
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 16, padding: 12, color: "#000", background: "#ffe8e8", borderRadius: 8 }}>
              <b>Error:</b> {error}
            </div>
          )}

          {result && (
            <div style={{ marginTop: 16 }}>
              <h2>Results</h2>
              {result.truncated && (
                <div style={{ marginBottom: 8, padding: 10, background: "#fff6d6", borderRadius: 8 }}>
                  Showing first 1000 rows. Add <code>LIMIT</code> to control output.
                </div>
              )}

              <div style={{ overflow: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th
                          key={c}
                          style={{
                            position: "sticky",
                            top: 0,
                            background: "#f4f4f4",
                            textAlign: "left",
                            padding: 8,
                            borderBottom: "1px solid #ddd",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 200).map((row, i) => (
                      <tr key={i}>
                        {result.columns.map((c) => (
                          <td key={c} style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                            {String((row as any)[c] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p style={{ color: "#666", marginTop: 8 }}>
                Rendered first 200 rows (for UI speed). Query returned {result.rows.length} rows.
              </p>
            </div>
          )}
        </div>

        {/* RIGHT: tabbed side panel */}
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Explore</div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {(["Schema", "Stats", "Charts", "Chat"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ccc",
                  background: activeTab === t ? "#111" : "#fff",
                  color: activeTab === t ? "#fff" : "#111",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* ------------------------ L6: UI Schema ------------------------*/}
          {activeTab === "Schema" && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Schema</div>
              {schema.length === 0 ? (
                <p style={{ color: "#666" }}>Upload a CSV to see inferred columns and types.</p>
              ) : (
                <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr style={{ background: "#fafafa" }}>
                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Column</th>
                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schema.map((col) => (
                        <tr key={col.name}>
                          <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                            <code>{col.name}</code>
                          </td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{col.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {/* ------------------------ L7: Data Stats ------------------------*/}
          {activeTab === "Stats" && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Summary stats</div>

              <button
                onClick={() => void computeStats()}
                disabled={statsRunning || schema.length === 0}
                style={{ padding: "8px 12px" }}
              >
                {statsRunning ? "Computing..." : "Compute stats"}
              </button>

              <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
                Status: <b>{statsStatus}</b>
              </div>

              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.values(stats).length === 0 ? (
                  <p style={{ color: "#666" }}>Click “Compute stats” to profile columns.</p>
                ) : (
                  Object.values(stats).map((s) => (
                    <div key={s.name} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div>
                          <code>{s.name}</code>
                          <div style={{ color: "#666", fontSize: 12 }}>{s.type}</div>
                        </div>
                        <div style={{ color: "#666", fontSize: 12 }}>
                          nulls: {s.nulls.toLocaleString()} / {s.total.toLocaleString()}
                        </div>
                      </div>

                      {s.kind === "numeric" ? (
                        <div style={{ marginTop: 8, fontSize: 13 }}>
                          <div>min: <b>{s.min ?? "—"}</b> • max: <b>{s.max ?? "—"}</b></div>
                          <div>mean: <b>{s.mean ?? "—"}</b> • median: <b>{s.median ?? "—"}</b></div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, fontSize: 13 }}>
                          <div>distinct: <b>{s.distinct?.toLocaleString() ?? "—"}</b></div>
                          <div style={{ marginTop: 6 }}>
                            top values:
                            <ul style={{ margin: "6px 0 0 18px" }}>
                              {s.topValues.map((tv, idx) => (
                                <li key={idx}>
                                  <code>{tv.value.length > 60 ? tv.value.slice(0, 60) + "…" : tv.value}</code>{" "}
                                  — {tv.count.toLocaleString()}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
          {activeTab === "Charts" && <p style={{ color: "#666" }}>Next: distributions only where meaningful.</p>}
          {activeTab === "Chat" && <p style={{ color: "#666" }}>Next: Gemini-powered assistant.</p>}
        </div>
      </div>
    </div>
  );
}