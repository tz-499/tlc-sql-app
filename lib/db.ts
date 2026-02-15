import * as duckdb from "@duckdb/duckdb-wasm";

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

// ----------------------------- L3: Data Engine  ------------------------------
// Instantiates and Manages DuckDB-WASM runtime and lifecycle
export async function getDB(): Promise<duckdb.AsyncDuckDB> {
    if (dbPromise) return dbPromise;

    dbPromise = (async () => {
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

        // Important line for duckDB
        const workerUrl = URL.createObjectURL(
            new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
        );

        const worker = new Worker(workerUrl);
        const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);

        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

        URL.revokeObjectURL(workerUrl);
        return db;
    })();

    return dbPromise;
}