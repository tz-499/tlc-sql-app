import * as duckdb from "@duckdb/duckdb-wasm";
import { getDB } from "./db";

// ------------------------------- Type Exports --------------------------------
export type QueryResult = {
    columns: string[];
    rows: any[];
    elapsedMs: number;
    truncated: boolean;
};

export type ColumnInfo = {
    name: string;
    type: string;
};

export type NumericStats = {
    kind: "numeric";
    total: number;
    nonNull: number;
    nulls: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    median: number | null;
};

export type CategoricalStats = {
    kind: "categorical";
    total: number;
    nonNull: number;
    nulls: number;
    distinct: number | null;
    topValues: { value: string; count: number }[];
};

export type ColumnStats = {
    name: string;
    type: string;
} & (NumericStats | CategoricalStats);

// ----------------------------- Function Exports ------------------------------

// --------------------------- L4: Dataset Creation  ---------------------------
// Function ran after use uploads CSV
// Run DUCK DB query to create table
export async function loadCSVAsTablename(file: File) {
    const db = await getDB();
    const conn = await db.connect();

    try {
        // Register file as a handle (no full in-memory buffer)
        // DuckDB docs show this pattern for browser files via BROWSER_FILEREADER. :contentReference[oaicite:1]{index=1}
        await db.registerFileHandle(
            "upload.csv",
            file,
            duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
            true
        );

        await conn.query(`DROP TABLE IF EXISTS tablename;`);
        await conn.query(`
      CREATE TABLE tablename AS
      SELECT * FROM read_csv_auto('upload.csv', HEADER=true);
    `);
    } finally {
        await conn.close();
    }
}

// ----------------------------- L5: Query Exec  -------------------------------
// Helper function to add a LIMIT on SELECT queries 
function shouldAutoLimit(sql: string) {
    const normalized = sql.trim().toLowerCase();

    // Only auto-limit SELECT queries
    if (!normalized.startsWith("select")) return false;

    // Respect user-supplied LIMIT
    if (/\blimit\b/i.test(normalized)) return false;

    return true;
}

function stripTrailingSemicolons(sql: string) {
    return sql.replace(/;\s*$/g, "").trim();
}

export async function runSQL(sql: string, maxRows = 1000): Promise<QueryResult> {
    const db = await getDB();
    const conn = await db.connect();
    const start = performance.now();

    // Sanitize SQL colon before auto LIMIT
    const cleaned = stripTrailingSemicolons(sql);

    const finalSQL = shouldAutoLimit(cleaned)
        ? `${cleaned}\nLIMIT ${maxRows}`
        : cleaned;

    try {
        const result = await conn.query(finalSQL);
        const elapsedMs = performance.now() - start;

        const columns = result.schema.fields.map((f) => f.name);
        const rows = result.toArray();

        return {
            columns,
            rows,
            elapsedMs,
            truncated: shouldAutoLimit(cleaned) && rows.length >= maxRows,
        };
    } finally {
        await conn.close();
    }
}

// ----------------------------- L6: UI Schema  --------------------------------
// Help user undersatnd DB structure
export async function getSchema(): Promise<ColumnInfo[]> {
    const db = await getDB();
    const conn = await db.connect();
    try {
        // DuckDB supports DESCRIBE for tables
        const res = await conn.query(`DESCRIBE tablename;`);
        const rows = res.toArray() as any[];

        // DuckDB returns columns like: column_name, column_type, null, key, default, extra
        // We'll pick the first two safely.
        return rows.map((r) => ({
            name: String(r.column_name ?? r.name ?? ""),
            type: String(r.column_type ?? r.type ?? ""),
        }));
    } finally {
        await conn.close();
    }
}

// ------------------------- L7: Stats Computation  ----------------------------
function quoteIdent(name: string) {
    // double-quote identifiers, escape internal quotes
    return `"${name.replace(/"/g, '""')}"`;
}

function isNumericType(t: string) {
    const s = t.toLowerCase();
    return (
        s.includes("int") ||
        s.includes("double") ||
        s.includes("real") ||
        s.includes("decimal") ||
        s.includes("numeric") ||
        s.includes("float") ||
        s.includes("hugeint")
    );
}

export async function getColumnStats(name: string, type: string): Promise<ColumnStats> {
    const db = await getDB();
    const conn = await db.connect();

    const col = quoteIdent(name);

    try {
        // totals for any type
        const base = await conn.query(`
        SELECT
          COUNT(*)::BIGINT AS total,
          COUNT(${col})::BIGINT AS non_null
        FROM tablename
      `);
        const baseRow: any = base.toArray()[0];
        const total = Number(baseRow.total);
        const nonNull = Number(baseRow.non_null);
        const nulls = total - nonNull;

        if (isNumericType(type)) {
            const res = await conn.query(`
          SELECT
            MIN(${col}) AS min,
            MAX(${col}) AS max,
            AVG(${col}) AS mean,
            APPROX_QUANTILE(${col}, 0.5) AS median
          FROM tablename
          WHERE ${col} IS NOT NULL
        `);
            const r: any = res.toArray()[0];

            return {
                name,
                type,
                kind: "numeric",
                total,
                nonNull,
                nulls,
                min: r.min === null ? null : Number(r.min),
                max: r.max === null ? null : Number(r.max),
                mean: r.mean === null ? null : Number(r.mean),
                median: r.median === null ? null : Number(r.median),
            };
        }

        // categorical-ish: distinct + top values
        const distinctRes = await conn.query(`
        SELECT COUNT(DISTINCT ${col})::BIGINT AS distinct
        FROM tablename
      `);
        const distinctRow: any = distinctRes.toArray()[0];
        const distinct = Number(distinctRow.distinct);

        const topRes = await conn.query(`
        SELECT
          COALESCE(CAST(${col} AS VARCHAR), '(NULL)') AS value,
          COUNT(*)::BIGINT AS n
        FROM tablename
        GROUP BY 1
        ORDER BY n DESC
        LIMIT 5
      `);

        const topValues = (topRes.toArray() as any[]).map((x) => ({
            value: String(x.value),
            count: Number(x.n),
        }));

        return {
            name,
            type,
            kind: "categorical",
            total,
            nonNull,
            nulls,
            distinct,
            topValues,
        };
    } finally {
        await conn.close();
    }
}