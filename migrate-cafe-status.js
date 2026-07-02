// One-off migration: imports a Supabase `cafe_status` CSV export into this
// app's own Postgres `cafe_status` table.
//
// Usage (run once, from the bos-dashboard project folder):
//   npm install
//   DATABASE_URL="<paste from Railway Postgres Variables tab>" node migrate-cafe-status.js cafe_status_rows.csv
//
// Safe to re-run — uses UPSERT, so re-running with the same file just
// refreshes the same rows rather than duplicating them.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: DATABASE_URL=... node migrate-cafe-status.js <path-to-csv>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL first — copy it from Railway: your Postgres service -> Variables tab.');
  process.exit(1);
}

// Minimal RFC4180-style CSV parser — handles quoted fields containing
// commas, newlines, and escaped ("") double-quotes, which the `data`
// column (raw JSON) relies on.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

async function main() {
  const raw = fs.readFileSync(path.resolve(csvPath), 'utf8');
  const rows = parseCSV(raw);
  const header = rows[0];
  const dataRows = rows.slice(1);
  console.log(`Found ${dataRows.length} row(s) in ${csvPath}`);

  const col = name => header.indexOf(name);
  const iKey = col('store_key'), iName = col('store_name'), iFsm = col('fsm'), iRegion = col('region'), iData = col('data');
  if ([iKey, iName, iFsm, iRegion, iData].includes(-1)) {
    console.error('CSV is missing an expected column. Expected: store_key, store_name, fsm, region, data');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cafe_status (
      store_key  TEXT PRIMARY KEY,
      store_name TEXT,
      fsm        TEXT,
      region     TEXT,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  let ok = 0, failed = 0;
  for (const r of dataRows) {
    const storeKey = r[iKey];
    const storeName = r[iName];
    const fsm = r[iFsm];
    const region = r[iRegion];
    let data;
    try {
      data = JSON.parse(r[iData]);
    } catch (e) {
      console.error(`Skipping "${storeKey}" — could not parse its data column as JSON: ${e.message}`);
      failed++;
      continue;
    }
    try {
      await pool.query(
        `INSERT INTO cafe_status (store_key, store_name, fsm, region, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (store_key) DO UPDATE SET store_name=$2, fsm=$3, region=$4, data=$5, updated_at=NOW()`,
        [storeKey, storeName, fsm, region, data]
      );
      ok++;
      console.log(`  ✓ ${storeKey} (${storeName})`);
    } catch (e) {
      console.error(`  ✗ ${storeKey} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${ok} imported, ${failed} failed.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
