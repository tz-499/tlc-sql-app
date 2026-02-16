"use client";

import { useState, useEffect } from "react";
import {
  loadCSVAsTablename,
  runSQL,
  getSchema,
  getColumnStats,
  QueryResult,
  ColumnInfo,
  ColumnStats,
  getNumericHistogram,
  getCategoricalBar,
  HistogramData,
  BarData,
  StepStatus,
  E2EStep,
} from "@/lib/engine";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, registerables } from "chart.js";
ChartJS.register(...registerables);

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

  const [selectedCol, setSelectedCol] = useState<string>("");
  const [chartStatus, setChartStatus] = useState<string>("Not generated");
  const [chartData, setChartData] = useState<HistogramData | BarData | null>(null);

  useEffect(() => {
    if (!selectedCol && schema.length > 0) {
      setSelectedCol(schema[0].name);
    }
  }, [schema, selectedCol]);

  const [e2eRunning, setE2eRunning] = useState(false);
  const [e2eSteps, setE2eSteps] = useState<E2EStep[]>([]);

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

  // ----------------------------- L8: Charting ------------------------------
  async function generateChart() {
    if (!selectedCol) return;
    const s = stats[selectedCol];
    if (!s) {
      setChartStatus("Compute stats first (Charts uses stats to decide what to show).");
      return;
    }

    setChartStatus("Generating chart...");
    setChartData(null);

    try {
      if (s.kind === "numeric") {
        const min = s.min ?? 0;
        const max = s.max ?? 0;
        const h = await getNumericHistogram(selectedCol, min, max, 20);
        setChartData(h);
      } else {
        const b = await getCategoricalBar(selectedCol, 15);
        setChartData(b);
      }
      setChartStatus("Done ✅");
    } catch (e: any) {
      setChartStatus("Failed ❌");
      setError(e?.message ?? String(e));
    }
  }

  // To help with Featured Insight
  function hasCol(name: string) {
    return schema.some((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  function setStep(idx: number, patch: Partial<E2EStep>) {
    setE2eSteps((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }

  // ----------------------------- E2E Testing ------------------------------
  async function runE2ETest() {
    setError(null);
    setResult(null);
    setE2eRunning(true);

    // Define steps up front
    const steps: E2EStep[] = [
      { name: "Create test CSV", status: "pending" },
      { name: "Upload + create tablename", status: "pending" },
      { name: "Run SQL query", status: "pending" },
      { name: "Compute stats", status: "pending" },
      { name: "Generate chart data", status: "pending" },
    ];
    setE2eSteps(steps);

    try {
      // 1) Create test CSV (10+ columns, mix numeric/categorical)
      const TEST_CSV = [
        "trip_id,category,value,tip_amount,total_amount,PULocationID,DOLocationID,passenger_count,payment_type,day_of_week,is_rush_hour",
        "1,A,10,2,20,138,161,1,1,Mon,true",
        "2,A,12,0,18,138,236,2,2,Tue,false",
        "3,B,8,1,12,236,161,1,1,Wed,true",
        "4,B,30,5,45,161,100,3,1,Thu,true",
        "5,C,22,3,28,100,161,1,2,Fri,false",
        "6,C,18,0,18,100,236,2,2,Sat,false",
        "7,A,40,10,60,138,161,1,1,Sun,true",
        "8,B,5,0,5,236,100,1,2,Mon,false",
        "9,C,16,2,22,161,138,2,1,Tue,true",
        "10,A,9,1,11,138,161,1,1,Wed,false",
      ].join("\n");

      setStep(0, { status: "pass", detail: "CSV created in memory" });

      const file = new File([TEST_CSV], "e2e_test.csv", { type: "text/csv" });

      // 2) Upload + create tablename
      try {
        await onUpload(file);
        setStep(1, { status: "pass", detail: "tablename created" });
      } catch (e: any) {
        setStep(1, { status: "fail", detail: e?.message ?? String(e) });
        throw e;
      }

      // 3) Run SQL query
      try {
        const q = "SELECT COUNT(*) AS n FROM tablename;";
        setSql(q);
        await onRun(); // relies on current sql state; if your onRun reads sql state, this is fine.
        setStep(2, { status: "pass", detail: "COUNT(*) executed" });
      } catch (e: any) {
        setStep(2, { status: "fail", detail: e?.message ?? String(e) });
        throw e;
      }

      // 4) Compute stats
      try {
        await computeStats();
        setStep(3, { status: "pass", detail: "Stats computed" });
      } catch (e: any) {
        setStep(3, { status: "fail", detail: e?.message ?? String(e) });
        throw e;
      }

      // 5) Generate chart data
      try {
        // pick a numeric column that exists in test CSV
        setSelectedCol("value");
        await generateChart();
        setStep(4, { status: "pass", detail: "Chart data generated" });
      } catch (e: any) {
        setStep(4, { status: "fail", detail: e?.message ?? String(e) });
        throw e;
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setE2eRunning(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>CSV SQL Explorer</h1>

      {/* Header row (keep your existing upload/status UI) */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
        {/* Pretty Upload Button */}
        <label
          htmlFor="csv-upload"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 10,
            background: "#2563eb",
            color: "white",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            border: "1px solid rgba(0,0,0,0.08)",
          }}
        >
          Upload CSV
        </label>
        {/* Hidden file input */}
        <input
          id="csv-upload"
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload(f);
            // optional: allow re-uploading the same file without refreshing
            e.currentTarget.value = "";
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
        {/* E2E Testing Button*/}
        <button
          onClick={() => void runE2ETest()}
          disabled={e2eRunning}
          style={{
            padding: "8px 12px",
            marginLeft: "auto",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: e2eRunning ? "#f3f4f6" : "#111",
            color: e2eRunning ? "#666" : "#fff",
            cursor: e2eRunning ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {e2eRunning ? "Running E2E..." : "Run End-to-End Test"}
        </button>
      </div>

      {/* E2E Testing Output */}
      {e2eSteps.length > 0 && (
        <div style={{ marginBottom: 16, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>End-to-End Test</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {e2eSteps.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <b>
                    {s.status === "pass" ? "✅" : s.status === "fail" ? "❌" : s.status === "skipped" ? "⏭️" : "⏳"}
                  </b>{" "}
                  {s.name}
                </div>
                <div style={{ color: "#666", fontSize: 12, maxWidth: 520, textAlign: "right" }}>
                  {s.detail ?? ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
              {/* "Featured Insight" Button */}
              <button
                onClick={() => {
                  if (!hasCol("tip_amount") || !hasCol("total_amount")) {
                    setError("Featured Insight requires tip_amount and total_amount columns.");
                    return;
                  }
                  const groupCol = hasCol("PULocationID") ? "PULocationID" : null;
                  if (!groupCol) {
                    setError("Featured Insight requires PULocationID (pickup zone) column.");
                    return;
                  }
                  const q = `SELECT My ${groupCol},
  ROUND(AVG(tip_amount / NULLIF(total_amount, 0)), 4) AS avg_tip_rate,
  COUNT(*) AS trips
  FROM tablename
  WHERE total_amount > 0
  GROUP BY 1
  HAVING COUNT(*) > 5000
  ORDER BY avg_tip_rate DESC
  LIMIT 20;`;
                  setSql(q);
                  void onRun();
                }}
                style={{ padding: "8px 12px", marginLeft: 8 }}
              >
                Run Featured Insight
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
                            background: "#fafafa",
                            color: "#111",
                            fontSize: 13,
                            letterSpacing: "0.01em",
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
          {/* ------------------------ L8: Charting ------------------------*/}
          {activeTab === "Charts" && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Distributions</div>

              {Object.keys(stats).length === 0 ? (
                <p style={{ color: "#666" }}>Compute stats first (Charts depends on column types + min/max).</p>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={selectedCol}
                      onChange={(e) => setSelectedCol(e.target.value)}
                      style={{ padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
                    >
                      <option value="" disabled>Select a column</option>
                      {schema.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>

                    <button onClick={() => void generateChart()} style={{ padding: "8px 12px" }}>
                      Generate chart
                    </button>
                  </div>

                  <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
                    Status: <b>{chartStatus}</b>
                  </div>

                  <div style={{ marginTop: 12, height: 260 }}>
                    {chartData?.kind === "histogram" && (
                      <Bar
                        data={{
                          labels: chartData.bins.map((b) => b.label),
                          datasets: [{ label: "Count", data: chartData.bins.map((b) => b.count) }],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { display: false } },
                          scales: { x: { ticks: { maxRotation: 90, minRotation: 60 } } },
                        }}
                      />
                    )}

                    {chartData?.kind === "bar" && (
                      <Bar
                        data={{
                          labels: chartData.points.map((p) => p.label.length > 20 ? p.label.slice(0, 20) + "…" : p.label),
                          datasets: [{ label: "Count", data: chartData.points.map((p) => p.count) }],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { display: false } },
                        }}
                      />
                    )}

                    {!chartData && <p style={{ color: "#666" }}>Pick a column and click “Generate chart”.</p>}
                  </div>
                </>
              )}
            </>
          )}
          {activeTab === "Chat" && <p style={{ color: "#666" }}>Next: Gemini-powered assistant.</p>}
        </div>
      </div>
    </div>
  );
}