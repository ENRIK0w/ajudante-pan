import * as XLSX from "xlsx";

export interface BudgetRow {
  ciclo: string;
  empresa: string;
  tp: string;
  years: Record<string, number>;
  total: number;
}

export interface BudgetDb {
  rows: BudgetRow[];
  empresas: string[];
  tps: string[];
  years: string[];
}

export interface CnpjEntry {
  code: string;
  name: string;
  normalized: string;
}

// PESE (Turn Key) base interfaces
export interface PeseRow {
  empresa: string;
  tp: string;
  peseCode: string;
  years: Record<string, number>;
  total: number;
}

export interface PeseDb {
  rows: PeseRow[];
  empresas: string[];
  tps: string[];
  peseCodes: string[];
  years: string[];
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export async function loadBudgetFromUrl(url: string): Promise<BudgetDb> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return parseBudgetBuffer(buf);
}

export function parseBudgetBuffer(buf: ArrayBuffer): BudgetDb {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const header = json[0].map((h: any) => String(h).trim());
  const yearCols: { idx: number; year: string }[] = [];
  header.forEach((h: string, i: number) => {
    if (/^20\d{2}$/.test(h)) yearCols.push({ idx: i, year: h });
  });

  const rows: BudgetRow[] = [];
  const empresasSet = new Set<string>();
  const tpsSet = new Set<string>();
  for (let i = 1; i < json.length; i++) {
    const r = json[i];
    if (!r || r.length === 0) continue;
    const ciclo = String(r[0] ?? "").trim();
    const empresa = String(r[1] ?? "").trim();
    const tp = String(r[2] ?? "").trim();
    // Skip invalid rows: empresa must be at least 2 chars, tp must exist
    if (!empresa || empresa.length < 2 || !tp) continue;
    const years: Record<string, number> = {};
    for (const { idx, year } of yearCols) {
      years[year] = Number(r[idx]) || 0;
    }
    const total = Number(r[r.length - 1]) || Object.values(years).reduce((a, b) => a + b, 0);
    rows.push({ ciclo, empresa, tp, years, total });
    empresasSet.add(empresa);
    tpsSet.add(tp);
  }

  return {
    rows,
    empresas: Array.from(empresasSet).sort(),
    tps: Array.from(tpsSet).sort(),
    years: yearCols.map((y) => y.year),
  };
}

export async function loadCnpjFromUrl(url: string): Promise<CnpjEntry[]> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const entries: CnpjEntry[] = [];
  for (let i = 1; i < json.length; i++) {
    const r = json[i];
    if (!r) continue;
    const code = String(r[0] ?? "").trim();
    const name = String(r[1] ?? "").trim();
    // Skip invalid entries: code must be at least 2 chars, name at least 3 chars
    if (!code || code.length < 2 || !name || name.length < 3) continue;
    entries.push({ code, name, normalized: normalize(name) });
  }
  return entries;
}

const STRIP_SUFFIX_RE =
  /\b(s\/?a|s\.a\.?|sa|ltda\.?|ltd\.?|spe|epp|me|eireli)\b/g;
const stripSuffix = (s: string) =>
  s.replace(STRIP_SUFFIX_RE, "").replace(/\s+/g, " ").trim();

const STOP_WORDS = new Set([
  "de","da","do","das","dos","e","cia","companhia","cpfl","spe","ltda","sa","s","a",
  "energia","energ","energias","energetico","energetica","renovaveis","forca","luz",
]);
const tokensOf = (s: string) =>
  s.split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w));

export function matchEmpresaCode(
  panName: string,
  cnpj: CnpjEntry[],
  db?: BudgetDb,
): string | null {
  const target = normalize(panName);
  if (!target) return null;

  // 0) Direct hit against budget DB empresa column (names like "CPFL Renovaveis")
  if (db) {
    const dHit = db.empresas.find((e) => normalize(e) === target);
    if (dHit) return dHit;
  }

  // 1) Exact CNPJ match
  let hit = cnpj.find((c) => c.normalized === target);
  if (hit) return hit.code;

  // 2) Strip corporate suffixes on both sides
  const tClean = stripSuffix(target);
  hit = cnpj.find((c) => stripSuffix(c.normalized) === tClean);
  if (hit) return hit.code;

  // 3) Substring either way — prefer the longest candidate
  // Require minimum 3 chars to avoid matching single letters like "a" from "S/A"
  const subs = cnpj.filter(
    (c) =>
      c.normalized.length >= 3 &&
      (c.normalized.includes(target) || target.includes(c.normalized)),
  );
  if (subs.length) {
    subs.sort((a, b) => b.normalized.length - a.normalized.length);
    return subs[0].code;
  }

  // 4) Weighted token overlap (longer/rarer tokens score higher)
  const tt = tokensOf(tClean);
  if (tt.length === 0) return null;
  let best: { code: string; score: number } | null = null;
  for (const c of cnpj) {
    const ct = new Set(tokensOf(stripSuffix(c.normalized)));
    let score = 0;
    for (const w of tt) if (ct.has(w)) score += w.length;
    if (score >= 5 && (!best || score > best.score)) best = { code: c.code, score };
  }
  return best?.code ?? null;
}

// PAN may bring TPs as "29C", "29C - Reforma de Rede", or the program name itself.
// DB stores codes ("29", "0R", "1F") and full names ("Reforma de Rede"). Try multiple
// strategies and return the actual DB key when found.
export function normalizeTp(tp: string): string {
  return tp.trim().toUpperCase();
}

const tpStrip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function matchTpCode(panTp: string, db: BudgetDb): string | null {
  const raw = panTp.trim();
  if (!raw) return null;

  // 1) Exact / case-insensitive
  const up = raw.toUpperCase();
  let hit = db.tps.find((t) => t.toUpperCase() === up);
  if (hit) return hit;

  // 2) "<code> - <nome>" → try each part
  const parts = raw.split(/\s*[-–—:]\s*/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const pu = p.toUpperCase();
    hit = db.tps.find((t) => t.toUpperCase() === pu);
    if (hit) return hit;
  }

  // 3) First token as the alphanumeric code ("29C", "0R")
  const firstTok = raw.split(/\s+/)[0].toUpperCase();
  hit = db.tps.find((t) => t.toUpperCase() === firstTok);
  if (hit) return hit;

  // 4) Match by program name, accent-insensitive
  const rawN = tpStrip(raw);
  if (rawN.length >= 4) {
    const nameHits = db.tps
      .filter((t) => {
        const tn = tpStrip(t);
        return tn.length >= 4 && (tn === rawN || tn.includes(rawN) || rawN.includes(tn));
      })
      .sort((a, b) => b.length - a.length);
    if (nameHits.length) return nameHits[0];
  }

  // 5) Last resort: digit-only prefix ("29C" → "29")
  const digits = firstTok.match(/^\d+/)?.[0];
  if (digits) {
    hit = db.tps.find((t) => t.toUpperCase() === digits);
    if (hit) return hit;
  }
  return null;
}

function rowsFor(db: BudgetDb, empresa: string, tp: string) {
  const tpU = tp.toUpperCase();
  let m = db.rows.filter(
    (r) => r.empresa === empresa && r.tp.toUpperCase() === tpU,
  );
  if (m.length === 0) {
    const tn = tpStrip(tp);
    m = db.rows.filter((r) => r.empresa === empresa && tpStrip(r.tp) === tn);
  }
  return m;
}

export function lookupBudget(
  db: BudgetDb,
  empresa: string,
  tp: string,
  years: number[],
): number {
  let sum = 0;
  for (const row of rowsFor(db, empresa, tp)) {
    for (const y of years) sum += row.years[String(y)] ?? 0;
  }
  return sum;
}

export function lookupBudgetByYear(
  db: BudgetDb,
  empresa: string,
  tp: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rowsFor(db, empresa, tp)) {
    for (const [y, v] of Object.entries(row.years)) {
      out[y] = (out[y] ?? 0) + v;
    }
  }
  return out;
}

// ==================== PESE (Turn Key) Functions ====================

export async function loadPeseFromUrl(url: string): Promise<PeseDb> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return parsePeseBuffer(buf);
}

export function mergePeseDbsByYear(
  legacyDb: PeseDb,
  futureDb: PeseDb,
  cutoverYear = 2027,
): PeseDb {
  const rowsByCode = new Map<string, PeseRow>();

  const addRows = (
    db: PeseDb,
    includeYear: (year: number) => boolean,
    preferMetadata: boolean,
  ) => {
    for (const row of db.rows) {
      const key = row.peseCode.toUpperCase().trim();
      let merged = rowsByCode.get(key);

      if (!merged) {
        merged = { ...row, years: {}, total: 0 };
        rowsByCode.set(key, merged);
      } else if (preferMetadata) {
        merged.empresa = row.empresa;
        merged.tp = row.tp;
        merged.peseCode = row.peseCode;
      }

      for (const [year, value] of Object.entries(row.years)) {
        if (includeYear(Number(year))) {
          merged.years[year] = (merged.years[year] ?? 0) + value;
        }
      }
    }
  };

  addRows(legacyDb, (year) => year < cutoverYear, false);
  addRows(futureDb, (year) => year >= cutoverYear, true);

  const rows = Array.from(rowsByCode.values()).map((row) => ({
    ...row,
    total: Object.values(row.years).reduce((sum, value) => sum + value, 0),
  }));

  return {
    rows,
    empresas: Array.from(new Set(rows.map((row) => row.empresa).filter(Boolean))).sort(),
    tps: Array.from(new Set(rows.map((row) => row.tp).filter(Boolean))).sort(),
    peseCodes: rows.map((row) => row.peseCode).sort(),
    years: Array.from(new Set(rows.flatMap((row) => Object.keys(row.years)))).sort(),
  };
}

export function parsePeseBuffer(buf: ArrayBuffer): PeseDb {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Find the header row (contains "EMPRESA", "TP", "CÓDIGO")
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, json.length); i++) {
    const row = json[i];
    if (row && row.some((cell: any) => String(cell).includes("EMPRESA"))) {
      headerIdx = i;
      break;
    }
  }

  const header = json[headerIdx].map((h: any) => String(h ?? "").trim());
  const normalizedHeader = header.map(normalize);
  const empresaIdx = normalizedHeader.findIndex((h) => h === "empresa");
  const tpIdx = normalizedHeader.findIndex((h) => h === "tp");
  const peseCodeIdx = normalizedHeader.findIndex(
    (h) => h.includes("codigo") && (h.includes("obra") || h.includes("projeto")),
  );

  // Find year columns (format: "2026 - CM", "2027 - CM", etc.)
  const yearCols: { idx: number; year: string }[] = [];
  header.forEach((h: string, i: number) => {
    const yearMatch = h.match(/^(20\d{2})\s*-?\s*CM?$/i);
    if (yearMatch) {
      yearCols.push({ idx: i, year: yearMatch[1] });
    }
  });

  const rows: PeseRow[] = [];
  const empresasSet = new Set<string>();
  const tpsSet = new Set<string>();
  const peseCodesSet = new Set<string>();

  for (let i = headerIdx + 1; i < json.length; i++) {
    const r = json[i];
    if (!r || r.length === 0) continue;

    const empresa = String(r[empresaIdx >= 0 ? empresaIdx : 0] ?? "").trim();
    const tp = String(r[tpIdx >= 0 ? tpIdx : 1] ?? "").trim();
    const peseCode = String(r[peseCodeIdx >= 0 ? peseCodeIdx : 2] ?? "").trim();

    // Skip invalid rows
    if (!empresa || !peseCode) continue;

    const years: Record<string, number> = {};
    let total = 0;
    for (const { idx, year } of yearCols) {
      const val = Number(r[idx]) || 0;
      years[year] = val;
      total += val;
    }

    rows.push({ empresa, tp, peseCode, years, total });
    empresasSet.add(empresa);
    if (tp) tpsSet.add(tp);
    peseCodesSet.add(peseCode);
  }

  return {
    rows,
    empresas: Array.from(empresasSet).sort(),
    tps: Array.from(tpsSet).sort(),
    peseCodes: Array.from(peseCodesSet).sort(),
    years: yearCols.map((y) => y.year),
  };
}

export function lookupPeseByCode(
  db: PeseDb,
  peseCode: string,
): PeseRow | null {
  const normalized = peseCode.toUpperCase().trim();
  return db.rows.find((r) => r.peseCode.toUpperCase() === normalized) ?? null;
}

// Tax multiplier for PESE budget (impostos)
const PESE_TAX_MULTIPLIER = 1.219512;

export function lookupPeseByYear(
  db: PeseDb,
  peseCode: string,
): Record<string, number> {
  const row = lookupPeseByCode(db, peseCode);
  if (!row) return {};
  // Apply tax multiplier to PESE values
  const result: Record<string, number> = {};
  for (const [year, value] of Object.entries(row.years)) {
    result[year] = value * PESE_TAX_MULTIPLIER;
  }
  return result;
}

export function matchPeseCode(
  panPeseCode: string,
  db: PeseDb,
): string | null {
  if (!panPeseCode) return null;
  const normalized = panPeseCode.toUpperCase().trim();

  // 1) Exact match
  let hit = db.peseCodes.find((c) => c.toUpperCase() === normalized);
  if (hit) return hit;

  // 2) Partial match (contains)
  hit = db.peseCodes.find(
    (c) => c.toUpperCase().includes(normalized) || normalized.includes(c.toUpperCase()),
  );
  if (hit) return hit;

  return null;
}

// TI (IT) database interfaces
export interface TiRow {
  empresa: string;
  tp: string;
  descricaoTp: string;
  programaOrcamentario: string;
  descricaoProjeto: string;
  years: Record<string, number>;
  total: number;
}

export interface TiDb {
  rows: TiRow[];
  empresas: string[];
  tps: string[];
  programas: string[];
  years: string[];
}

export function parseTiBuffer(buf: ArrayBuffer): TiDb {
  const wb = XLSX.read(buf, { type: "array" });
  const wantedYears = ["2026", "2027", "2028", "2029", "2030"];

  const allRows: TiRow[] = [];
  const empresasSet = new Set<string>();
  const tpsSet = new Set<string>();
  const programasSet = new Set<string>();
  const yearsFound = new Set<string>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // Find header row: first row (within first 5) where col 0 === "EMPRESA"
    let headerIdx = -1;
    for (let i = 0; i < Math.min(5, json.length); i++) {
      const r = json[i];
      if (r && String(r[0] ?? "").trim() === "EMPRESA") {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const header = json[headerIdx].map((h: any) => String(h ?? "").trim());

    // Year columns: first occurrence of each year to avoid duplicate year columns
    const yearCols: { idx: number; year: string }[] = [];
    const seenYears = new Set<string>();
    header.forEach((h: string, i: number) => {
      if (wantedYears.includes(h) && !seenYears.has(h)) {
        yearCols.push({ idx: i, year: h });
        seenYears.add(h);
        yearsFound.add(h);
      }
    });

    // Description column: first col >= 8 matching "DESCR" but not "DESCRIÇÃO TP"
    const descrColIdx = header.findIndex(
      (h, i) => i >= 8 && /DESCR/i.test(h) && !/DESCRI[CÇ][AÃ]O\s*TP/i.test(h),
    );

    // Total column: first col after the last year col containing "TOTAL"
    const lastYearColIdx = yearCols.length > 0 ? Math.max(...yearCols.map((y) => y.idx)) : 0;
    const totalColIdx = header.findIndex((h, i) => i > lastYearColIdx && /TOTAL/i.test(h));

    for (let i = headerIdx + 1; i < json.length; i++) {
      const r = json[i];
      if (!r || r.length === 0) continue;
      const empresa = String(r[0] ?? "").trim();
      const tp = String(r[2] ?? "").trim();
      const descricaoTp = String(r[3] ?? "").trim();
      const programaOrcamentario = String(r[7] ?? "").trim();
      const descricaoProjeto = descrColIdx >= 0 ? String(r[descrColIdx] ?? "").trim() : "";
      if (!empresa || !programaOrcamentario) continue;
      const years: Record<string, number> = {};
      for (const { idx, year } of yearCols) {
        years[year] = Number(r[idx]) || 0;
      }
      const yearSum = Object.values(years).reduce((a, b) => a + b, 0);
      const total = totalColIdx >= 0 ? (Number(r[totalColIdx]) || yearSum) : yearSum;
      allRows.push({ empresa, tp, descricaoTp, programaOrcamentario, descricaoProjeto, years, total });
      empresasSet.add(empresa);
      if (tp) tpsSet.add(tp);
      programasSet.add(programaOrcamentario);
    }
  }

  return {
    rows: allRows,
    empresas: Array.from(empresasSet).sort(),
    tps: Array.from(tpsSet).sort(),
    programas: Array.from(programasSet).sort(),
    years: wantedYears.filter((y) => yearsFound.has(y)),
  };
}

export async function loadTiFromUrl(url: string): Promise<TiDb> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return parseTiBuffer(buf);
}

export function lookupTiByYear(
  db: TiDb,
  empresa: string,
  tp: string,
  programa: string,
): Record<string, number> {
  const row = db.rows.find(
    (r) =>
      r.empresa === empresa &&
      r.tp === tp &&
      r.programaOrcamentario === programa,
  );
  return row ? row.years : {};
}

export function getTiOptions(db: TiDb, empresa: string, tp: string): TiRow[] {
  return db.rows.filter((r) => r.empresa === empresa && r.tp === tp);
}

export function matchTiPrograma(
  panPrograma: string | undefined,
  options: TiRow[],
): string | null {
  // 1) Single option → return it
  if (options.length === 1) return options[0].programaOrcamentario;

  if (panPrograma) {
    const target = panPrograma.toUpperCase().trim();
    if (target) {
      // 2a) Exact match (case-insensitive)
      let hit = options.find(
        (o) => o.programaOrcamentario.toUpperCase().trim() === target,
      );
      if (hit) return hit.programaOrcamentario;

      // 2b) Substring match (either contains the other)
      hit = options.find((o) => {
        const p = o.programaOrcamentario.toUpperCase().trim();
        return p.includes(target) || target.includes(p);
      });
      if (hit) return hit.programaOrcamentario;
    }
  }

  return null;
}

// Match by DESCR. OBRA / PROJETO / EQUIPAMENTO against descricaoProjeto in TiRow.
// Returns the programaOrcamentario key for the matched row, or null.
export function matchTiDescricao(panDescricao: string | undefined, options: TiRow[]): string | null {
  if (options.length === 1) return options[0].programaOrcamentario;
  if (!panDescricao) return null;
  const target = panDescricao.toUpperCase().trim();
  if (!target) return null;
  let hit = options.find((o) => {
    const d = o.descricaoProjeto.toUpperCase().trim();
    return d && (d === target || d.includes(target) || target.includes(d));
  });
  return hit?.programaOrcamentario ?? null;
}
