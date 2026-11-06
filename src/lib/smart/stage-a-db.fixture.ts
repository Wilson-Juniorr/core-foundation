import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
/** Test-only PostgreSQL. No network, credentials or production rows. */
export async function testDatabase() {
  const pg = new PGlite();
  await pg.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TYPE public.followup_run_status AS ENUM('active','paused','stopped','completed','cancelled','failed');",
  );
  const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const section = types.split("Tables: {")[1]?.split("Views: {")[0] ?? "";
  for (const match of section.matchAll(/ {6}(\w+): \{\s+Row: \{([\s\S]*?)\n        \}/g)) {
    const table = match[1],
      body = match[2] ?? "";
    const columns = [...body.matchAll(/ {10}(\w+): ([^\n]+)/g)].map((m) => {
      const name = m[1],
        type = m[2] ?? "";
      const sqlType =
        name === "id" || name?.endsWith("_id") || name === "evaluation_token"
          ? "uuid"
          : type.includes("Json")
            ? "jsonb"
            : type.startsWith("number")
              ? name?.includes("confidence") || name?.includes("value")
                ? "numeric"
                : "integer"
              : type.startsWith("boolean")
                ? "boolean"
                : name?.endsWith("_at") || name?.endsWith("_until") || name === "scheduled_for"
                  ? "timestamptz"
                  : table === "followup_runs" && name === "status"
                    ? "public.followup_run_status"
                    : "text";
      const defaults =
        name === "id"
          ? " DEFAULT gen_random_uuid() PRIMARY KEY"
          : name === "created_at" || name === "updated_at"
            ? " DEFAULT now()"
            : name === "context_version"
              ? " DEFAULT 1"
              : name === "contacts_done" || name === "attempts"
                ? " DEFAULT 0"
                : name === "status" && table === "scheduled_actions"
                  ? " DEFAULT 'scheduled'"
                  : "";
      return `"${name}" ${sqlType}${defaults}`;
    });
    await pg.exec(`CREATE TABLE public.${table} (${columns.join(",")});`);
  }
  const sql = readFileSync("drizzle/migrations/0004_post_quote_stage_a.sql", "utf8");
  const functions = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"));
  await pg.exec(functions);
  await pg.exec(
    "CREATE UNIQUE INDEX test_pending ON scheduled_actions(flow_run_id,logical_contact) WHERE logical_contact IS NOT NULL AND status IN ('scheduled','processing','needs_approval','blocked');",
  );
  const db = {
    from: (table: string) => new Query(pg, table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      const keys = Object.keys(args),
        values = Object.values(args).map((v) =>
          typeof v === "object" && v !== null ? JSON.stringify(v) : v,
        );
      try {
        const result = await pg.query(
          `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) AS result`,
          values,
        );
        return { data: (result.rows[0] as { result: unknown })?.result, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
  };
  return { pg, db };
}
class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: string[] = [];
  private values: unknown[] = [];
  private limitCount = 10000;
  private orderFields: string[] = [];
  private mode = "select";
  private payload: Record<string, unknown>[] = [];
  private singleRow = false;
  constructor(
    private pg: PGlite,
    private table: string,
  ) {}
  select(_columns = "*") {
    return this;
  }
  private param(v: unknown) {
    this.values.push(v);
    return `$${this.values.length}`;
  }
  eq(k: string, v: unknown) {
    this.filters.push(`"${k.split(".")[0]}" = ${this.param(v)}`);
    return this;
  }
  neq(k: string, v: unknown) {
    this.filters.push(`"${k}" <> ${this.param(v)}`);
    return this;
  }
  in(k: string, v: unknown[]) {
    this.filters.push(`"${k}" IN (${v.map((x) => this.param(x)).join(",")})`);
    return this;
  }
  is(k: string, v: unknown) {
    this.filters.push(`"${k}" IS ${v === null ? "NULL" : v}`);
    return this;
  }
  not(k: string, _op: string, _v: unknown) {
    this.filters.push(`"${k}" IS NOT NULL`);
    return this;
  }
  gt(k: string, v: unknown) {
    this.filters.push(`"${k}" > ${this.param(v)}`);
    return this;
  }
  gte(k: string, v: unknown) {
    this.filters.push(`"${k}" >= ${this.param(v)}`);
    return this;
  }
  lt(k: string, v: unknown) {
    this.filters.push(`"${k}" < ${this.param(v)}`);
    return this;
  }
  lte(k: string, v: unknown) {
    this.filters.push(`"${k}" <= ${this.param(v)}`);
    return this;
  }
  or(expression: string) {
    const parts = expression.split(/,(?![^()]*\))/);
    const translate = (e: string): string => {
      if (e.startsWith("and("))
        return "(" + e.slice(4, -1).split(",").map(translate).join(" AND ") + ")";
      const [key, op, ...rest] = e.split(".");
      const value = rest.join(".");
      if (op === "is") return `"${key}" IS NULL`;
      const operators: Record<string, string> = {
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
        eq: "=",
        neq: "<>",
      };
      return `"${key}" ${operators[op ?? ""]} ${this.param(value)}`;
    };
    this.filters.push("(" + parts.map(translate).join(" OR ") + ")");
    return this;
  }
  order(k: string, o: { ascending?: boolean } = {}) {
    this.orderFields.push(`"${k}" ${o.ascending === false ? "DESC" : "ASC"}`);
    return this;
  }
  limit(n: number) {
    this.limitCount = n;
    return this;
  }
  update(p: Record<string, unknown>) {
    this.mode = "update";
    this.payload = [p];
    return this;
  }
  insert(p: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = "insert";
    this.payload = Array.isArray(p) ? p : [p];
    return this;
  }
  upsert(p: Record<string, unknown> | Record<string, unknown>[]) {
    return this.insert(p);
  }
  single() {
    this.singleRow = true;
    return this;
  }
  maybeSingle() {
    this.singleRow = true;
    return this;
  }
  async then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    resolve?:
      ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(resolve, reject);
  }
  private async execute() {
    try {
      const where = this.filters.length ? " WHERE " + this.filters.join(" AND ") : "";
      let sql = "";
      if (this.mode === "select")
        sql = `SELECT * FROM "${this.table}"${where}${this.orderFields.length ? " ORDER BY " + this.orderFields.join(",") : ""} LIMIT ${this.limitCount}`;
      if (this.mode === "update") {
        const p = this.payload[0] ?? {};
        const sets = Object.entries(p).map(([k, v]) => `"${k}"=${this.param(v)}`);
        sql = `UPDATE "${this.table}" SET ${sets.join(",")}${where} RETURNING *`;
      }
      if (this.mode === "insert") {
        const p = this.payload[0] ?? {};
        const cols = Object.keys(p);
        sql = `INSERT INTO "${this.table}"(${cols.map((k) => `"${k}"`).join(",")}) VALUES (${cols.map((k) => this.param(typeof p[k] === "object" && p[k] !== null ? JSON.stringify(p[k]) : p[k])).join(",")}) RETURNING *`;
      }
      const result = await this.pg.query(sql, this.values);
      const rows = result.rows.map((raw) => {
        const row = raw as Record<string, unknown>;
        for (const [k, v] of Object.entries(row)) if (v instanceof Date) row[k] = v.toISOString();
        return row;
      });
      if (this.table === "followup_runs")
        for (const row of rows) {
          const flows = await this.pg.query("SELECT * FROM followup_flows WHERE id=$1", [
            row["flow_id"],
          ]);
          row["followup_flows"] = flows.rows[0] ?? null;
        }
      return { data: this.singleRow ? (rows[0] ?? null) : rows, error: null };
    } catch (e) {
      return { data: null, error: { message: String(e) } };
    }
  }
}
