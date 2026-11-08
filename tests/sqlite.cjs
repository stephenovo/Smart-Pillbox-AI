const { DatabaseSync } = require("node:sqlite");
const { readFileSync } = require("node:fs");
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0001_pilot.sql", "utf8"));
  function prepare(sql, values = []) {
    const statement = () => sqlite.prepare(sql);
    return {
      sql,
      values,
      bind(...next) {
        return prepare(sql, next);
      },
      async first() {
        return statement().get(...values) ?? null;
      },
      async all() {
        return { results: statement().all(...values) };
      },
      async run() {
        const r = statement().run(...values);
        return { meta: { changes: Number(r.changes) } };
      },
    };
  }
  return {
    sqlite,
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const rows = statements.map((s) => ({
          meta: {
            changes: Number(sqlite.prepare(s.sql).run(...s.values).changes),
          },
        }));
        sqlite.exec("COMMIT");
        return rows;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
module.exports = { database };
