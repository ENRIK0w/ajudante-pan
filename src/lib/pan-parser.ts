// Client-only PAN PDF parser. pdfjs uses DOMMatrix → never import at module top (breaks SSR).

export interface PanData {
  fileName: string;
  panNumber?: string;
  titulo?: string;
  historico?: string;
  valorTotal?: number;
  percentualCapex?: number;
  programaOrcamentario?: string;
  tp?: string;
  isTurnKey?: boolean;
  peseCode?: string;
  isTi?: boolean;
  tiCategory?: string;
  descricaoObra?: string;
  rateio: { empresa: string; valor: number }[];
  fluxoCaixa: { ano: number; valor: number }[];
  rawText: string;
}

export const parseBR = (s: string): number => {
  const cleaned = s.replace(/[R$\s.]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const loadPdfjs = async () => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
};

export async function parsePanPdf(file: File): Promise<PanData> {
  const pdfjsLib = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
      else if (text && !text.endsWith(" ") && !text.endsWith("\n")) text += " ";
      text += item.str;
      lastY = y;
    }
    text += "\n";
  }

  const data: PanData = { fileName: file.name, rateio: [], fluxoCaixa: [], rawText: text };

  const pan = text.match(/PAN\s*N[ºo°]?:?\s*([\d/]+)/i);
  if (pan) data.panNumber = pan[1];

  const tit = text.match(/T[ií]tulo:\s*(.+)/i);
  if (tit) data.titulo = tit[1].trim().split("\n")[0];

  const hist = text.match(/ESCOPO E HIST[ÓO]RICO[^\n]*\n([\s\S]*?)(?:VIG[ÊE]NCIA|OR[ÇC]AMENTO|Tipo de or[çc]amento)/i);
  if (hist) {
    data.historico = hist[1]
      .replace(/USO INTERNO/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const vtot = text.match(/Valor total a ser contratado[^\d]*([\d.,]+)/i);
  if (vtot) data.valorTotal = parseBR(vtot[1]);

  const cap = text.match(/Percentual\s*CAPEX[^\d]*([\d.,]+)/i);
  if (cap) data.percentualCapex = parseBR(cap[1]);

  const prog = text.match(/Programa\s+or[çc]ament[áa]rio:?\s*([^\n]+)/i);
  if (prog) {
    data.programaOrcamentario = prog[1].trim();
    const tpMatch = data.programaOrcamentario.match(/^(\S+)/);
    if (tpMatch) data.tp = tpMatch[1];
  }

  const rateioBlock = text.match(/Rateio entre empresas:?([\s\S]*?)(?:Informa[çc][õo]es sobre|Fluxo de caixa)/i);
  if (rateioBlock) {
    // Normalize whitespace: replace all whitespace (including newlines) with single space
    const block = rateioBlock[1].replace(/\s+/g, " ").trim();

    // Match pattern: Company name (greedy, at least 5 chars) followed by R$ value
    // The company name must start with a capital letter and can contain various chars
    const re = /([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9.\-\/\s]{4,}?(?:S\.?\/?\s*A\.?|Ltda\.?|SPE|EIRELI)?)\s+R\$\s*([\d.,]+)/gi;

    // Terms to remove from company names (noise from PDF parsing)
    const noiseTerms = /\b(uso\s+interno|empresa|valor|total|rateio|percentual|capex|opex|fluxo|justificativa|contratado?|fornecedor(?:es)?)\b/gi;

    let m;
    const seen = new Set<string>();
    while ((m = re.exec(block)) !== null) {
      let empresa = m[1].trim();
      // Normalize multiple spaces
      empresa = empresa.replace(/\s+/g, " ");
      // Remove noise terms from the name
      empresa = empresa.replace(noiseTerms, "").replace(/\s+/g, " ").trim();

      // Skip short names after cleanup
      if (empresa.length < 3) continue;

      // Skip duplicates
      const normalized = empresa.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      data.rateio.push({ empresa, valor: parseBR(m[2]) });
    }
  }

  const fluxoBlock = text.match(/Fluxo de caixa:?([\s\S]*?)(?:Justificativa|FORNECEDORES|Nome do fornecedor)/i);
  if (fluxoBlock) {
    const re = /(20\d{2})\s+R\$\s*([\d.,]+)/g;
    let m;
    while ((m = re.exec(fluxoBlock[1])) !== null) {
      data.fluxoCaixa.push({ ano: parseInt(m[1]), valor: parseBR(m[2]) });
    }
  }

  // Detect Turn Key (TK) classification
  // Look for "TK", "Turn Key", "Turn-Key", or "Turnkey" in the text
  const tkMatch = text.match(/\b(TK|Turn[\s-]?Key|Turnkey)\b/i);
  data.isTurnKey = !!tkMatch;

  // TI detection — only by TP code (79=Software, 2G=PIC, 2E=Cybersecurity, 2F=Investimento, 80=Hardware)
  const tiTpMatch = /^(79|2G|2E|2F|80)\b/i.test((data.tp ?? "").trim());
  data.isTi = tiTpMatch;
  if (data.isTi) {
    const tp = (data.tp ?? "").trim().toUpperCase();
    if (tp === "79") data.tiCategory = "Software";
    else if (tp === "2G") data.tiCategory = "PIC";
    else if (tp === "2E") data.tiCategory = "Cybersecurity";
    else if (tp === "2F") data.tiCategory = "Investimento";
    else if (tp === "80") data.tiCategory = "Hardware";
    else data.tiCategory = "TI";
  }

  // Extract DESCR. OBRA / PROJETO / EQUIPAMENTO for TI PANs
  // 1) Explicit "Linha orçamentária:" label in the PDF
  const linhaMatch = text.match(/Linha\s+or[çc]ament[áa]ria:?\s*([^\n]{3,})/i);
  if (linhaMatch) {
    data.descricaoObra = linhaMatch[1].trim();
  } else if (data.programaOrcamentario) {
    // 2) Text after "TP CODIGO [- description]" in the programa line
    const parts = data.programaOrcamentario.split(/\s+/);
    if (parts.length > 2) {
      const rest = parts.slice(2).join(" ").replace(/^[-–:]\s*/, "").trim();
      if (rest.length > 3) data.descricaoObra = rest;
    }
  }

  // Extract PESE code from the CAPEX section
  // Look for the line "Em caso de CAPEX, fazer uma conta resumo orçado x contratação"
  // The PESE code typically follows this pattern: PMT_XXX or similar project codes
  const capexSection = text.match(/Em caso de CAPEX[^]*?(?:resumo|orçado|contrata)/i);
  if (capexSection) {
    // Look for PESE code pattern (e.g., PMT_SE0931_EQU_SE_PIRACICABA8)
    const peseMatch = text.match(/\b(PMT_[A-Z0-9_]+|[A-Z]{2,4}_[A-Z0-9_]+)\b/i);
    if (peseMatch) {
      data.peseCode = peseMatch[1].toUpperCase();
    }
  }

  // Also try to find PESE code near "código" or "obra" or "projeto"
  if (!data.peseCode) {
    const codeMatch = text.match(/(?:c[óo]digo|obra|projeto)[:\s]*([A-Z]{2,4}_[A-Z0-9_]+)/i);
    if (codeMatch) {
      data.peseCode = codeMatch[1].toUpperCase();
    }
  }

  return data;
}
