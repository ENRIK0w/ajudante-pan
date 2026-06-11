# Ajudante PAN — Documentação Técnica

Ferramenta web para análise automática de PANs (Propostas de Ação), comparando os valores solicitados contra o orçamento disponível por empresa, programa (TP) e ano.

---

## Visão Geral do Fluxo

```
PDF da PAN → parsePanPdf → PanData
                                ↓
Excel databases ──────────→ matchEmpresaCode / matchTpCode / matchPeseCode
(orcamento, cnpj, pese)         ↓
                          AnalyzedPan (status: ok | warn | unknown)
                                ↓
                         Dashboard visual + Export Excel
```

---

## Estrutura de Arquivos

```
src/
├── app/
│   ├── layout.tsx          # Root layout + metadata
│   ├── page.tsx            # Toda a UI e lógica de estado
│   └── icon.svg            # Ícone da aba do navegador
├── components/
│   ├── providers.tsx       # ThemeProvider + QueryClient
│   └── theme-toggle.tsx    # Botão de alternância dark/light
├── lib/
│   ├── pan-parser.ts       # Extração de dados do PDF
│   └── budget-parser.ts    # Carga e matching das bases Excel
└── styles.css              # Design system (tokens oklch + utilities)

public/
├── orcamento.xlsx          # Base de orçamento (empresa × TP × ano)
├── cnpj.xlsx               # Tabela de lookup empresa → código
├── base pese.xlsx          # Orçamento Turn Key (PESE)
└── Resumo_PAN_2026.xlsx    # Exemplo de export
```

---

## `src/app/layout.tsx` — Root Layout

Wrapper mínimo da aplicação. Define o `<html>` com `suppressHydrationWarning` (necessário para o next-themes evitar mismatch de hidratação) e envolve tudo com `<Providers>`.

```ts
export const metadata: Metadata  // título, description, og, twitter
export default function RootLayout({ children })
```

---

## `src/app/page.tsx` — Dashboard Principal

Componente `"use client"` central da aplicação. Contém toda a lógica de estado, análise e UI.

### Tipos

| Tipo | Descrição |
|---|---|
| `YearCell` | Resultado de um ano: `{ year, requested, available, diff, ok }` |
| `PeseAnalysis` | Análise Turn Key: código PESE resolvido, `peseByYear[]`, total |
| `AnalyzedPan` | PAN completamente analisada: rows por empresa, year totals, status final |

### Estado (hooks)

| Estado | Tipo | Descrição |
|---|---|---|
| `db` | `BudgetDb \| null` | Base de orçamento carregada |
| `cnpj` | `CnpjEntry[] \| null` | Tabela CNPJ carregada |
| `peseDb` | `PeseDb \| null` | Base PESE carregada |
| `loadingBase` | `boolean` | Indica carregamento inicial das bases |
| `pans` | `PanData[]` | PDFs já processados |
| `overrides` | `Record<string, {...}>` | Correções manuais de TP / empresa / PESE por PAN |
| `processing` | `boolean` | PDF sendo processado |
| `expanded` | `Set<string>` | Quais PANs estão expandidas |
| `selected` | `Set<string>` | Quais PANs estão selecionadas para export |
| `exporting` | `boolean` | Export em andamento |
| `sidebarOpen` | `boolean` | Estado do painel lateral |

### Funções Principais

#### `fmtBRL(n: number) → string`
Formata número para moeda brasileira sem centavos. Exemplo: `1500000 → "R$ 1.500.000"`.

#### `handleFiles(files: FileList | null)`
Processa arquivos PDF carregados via input ou drag-and-drop. Chama `parsePanPdf` para cada arquivo e acumula em `pans`.

#### `analyzed` (useMemo)
Núcleo da análise. Para cada `PanData` em `pans`:

1. Aplica `overrides` (correções manuais de TP, empresa, PESE).
2. Calcula `capex` a partir de `percentualCapex` (`capex = %/100`).
3. Para cada empresa no rateio:
   - Resolve o código via `matchEmpresaCode`.
   - Calcula `share` (proporção do valor total solicitado).
   - Busca orçamento disponível por ano via `lookupBudgetByYear`.
   - Monta `byYear: YearCell[]` com `ok = requested ≤ available`.
4. Para PANs Turn Key, calcula `PeseAnalysis` via `lookupPeseByYear` (com multiplicador fiscal 1,2195).
5. Define `status`:
   - `"ok"` → tudo mapeado e dentro do orçamento.
   - `"warn"` → há déficit em algum ano ou empresa.
   - `"unknown"` → empresa ou TP não resolvidos.

#### `exportToExcel()`
Gera planilha `.xlsx` estilizada com `xlsx-js-style`:
- **Colunas azul escuro:** metadados da PAN (número, título, TP, PESE).
- **Colunas azul claro:** valores solicitados por ano (ex.: 2026).
- **Colunas verdes:** orçamento disponível por ano.
- **Colunas laranja:** variação (disponível − solicitado).
- **Coluna final:** status OK / WARN / UNKNOWN.

Só exporta PANs presentes em `selected`.

### Sub-componentes

#### `SidebarItem`
Item de navegação lateral com ícone, label (visível só se `sidebarOpen`) e badge numérico opcional.

#### `StatCard`
Card de métrica no topo do dashboard: ícone, título, valor e cor de acento configuráveis.

#### `PanCard`
Card principal por PAN. Expansível via clique. Mostra:
- Badge de status (OK / WARN / UNKNOWN).
- Totais solicitado vs. disponível.
- Tabela de empresas com matching e orçamento por ano.
- Painel PESE (para Turn Key).
- Seletor de TP e campos de override de empresa/PESE.

#### `HistoricoPanel`
Painel colapsável que exibe o campo `historico` (escopo e histórico de contratação) extraído do PDF.

#### `YearDetailCard`
Card clicável que detalha o cálculo de um determinado ano: valor solicitado, disponível e diferença, com breakdown por empresa.

---

## `src/lib/pan-parser.ts` — Parser de PDF

### Tipo `PanData`

```ts
interface PanData {
  fileName: string
  panNumber: string | null
  titulo: string | null
  historico: string | null        // Escopo e histórico de contratações
  valorTotal: number
  percentualCapex: number | null  // Ex: 80 para 80% CAPEX
  programaOrcamentario: string | null
  tp: string | null               // Código do programa orçamentário
  isTurnKey: boolean
  peseCode: string | null         // Código projeto PESE (ex: PMT_XXX)
  rateio: { empresa: string; valor: number }[]
  fluxoCaixa: { ano: number; valor: number }[]
  rawText: string
}
```

### `parsePanPdf(file: File) → Promise<PanData>`

Pipeline de extração:

1. **Carrega PDF** com `pdfjs-dist` (importação dinâmica para evitar SSR).
2. **Extrai texto** página a página, preservando quebras de linha por coordenada Y.
3. **Número e título** via regex no topo do documento.
4. **Seção `historico`** — captura tudo entre "Histórico" e "Escopo do Projeto" ou próxima seção.
5. **Valor total** e **percentual CAPEX** via regex.
6. **TP** — extraído de `programaOrcamentario` (ex.: `"29C - Reforma de Rede"` → `"29C"`).
7. **Rateio** — tabela de empresas e valores. Filtra termos de ruído (ex.: "uso interno", "valor", "empresa").
8. **Fluxo de caixa** — tabela de anos e valores. Ignora linhas sem número de ano válido.
9. **Turn Key** — detectado por keywords `"TK"`, `"Turn Key"`, `"Turn-Key"`, `"Turnkey"` em qualquer lugar do texto.
10. **Código PESE** — buscado na seção CAPEX por padrões `PMT_*` ou `*_*`, com fallback via keywords `"código"`, `"obra"`, `"projeto"`.

---

## `src/lib/budget-parser.ts` — Bases de Dados e Matching

### Tipos

| Tipo | Descrição |
|---|---|
| `BudgetRow` | Linha do orçamento: `{ ciclo, empresa, tp, years: Record<year, value>, total }` |
| `BudgetDb` | Base completa: `{ rows, empresas[], tps[], years[] }` |
| `CnpjEntry` | `{ code, name, normalized }` |
| `PeseRow` | Linha PESE: `{ empresa, tp, peseCode, years, total }` |
| `PeseDb` | Base PESE: `{ rows, empresas[], tps[], peseCodes[], years[] }` |

### Loaders

```ts
loadBudgetFromUrl(url: string) → Promise<BudgetDb>
loadCnpjFromUrl(url: string)   → Promise<CnpjEntry[]>
loadPeseFromUrl(url: string)   → Promise<PeseDb>
```

Buscam os arquivos Excel via `fetch`, passam o buffer para os parsers abaixo.

```ts
parseBudgetBuffer(buf: ArrayBuffer) → BudgetDb
parsePeseBuffer(buf: ArrayBuffer)   → PeseDb
```

Auto-detectam colunas de ano (formato `"20XX"` ou `"20XX - CM"`) nas primeiras linhas da planilha.

### Funções de Normalização

```ts
normalize(s: string) → string
```
Lowercase → remove acentos (NFD) → remove espaços e pontuação. Usada em todos os matchings.

```ts
stripSuffix(s: string) → string
```
Remove sufixos societários normalizados: `sa`, `ltda`, `spe`, `eireli`, `me`, `epp`, `inc`, `corp`, `co`.

```ts
tokensOf(s: string) → string[]
```
Divide string em tokens, remove stop words (`energia`, `eletrica`, `distribuidora`, `servicos`…) e tokens com menos de 3 caracteres.

### Matching de Empresa

```ts
matchEmpresaCode(panName: string, cnpj: CnpjEntry[], db: BudgetDb) → string | null
```

Estratégias em ordem de prioridade:

| # | Estratégia | Exemplo |
|---|---|---|
| 1 | Hit direto na coluna empresa do orçamento | `"COELBA"` → `"COELBA"` |
| 2 | Match exato normalizado no CNPJ | `"Coelba S/A"` → normalize → hit |
| 3 | Match após remover sufixo | `"Coelba Ltda"` → `"coelba"` → hit |
| 4 | Match por substring (candidato mais longo vence) | `"Coelba Distribui…"` contém `"coelba"` |
| 5 | Overlap ponderado de tokens (mínimo 5 pts, tokens longos valem mais) | fuzzy match por palavras significativas |

### Matching de TP

```ts
matchTpCode(panTp: string, db: BudgetDb) → string | null
```

| # | Estratégia |
|---|---|
| 1 | Match exato / case-insensitive |
| 2 | Cada parte splitada por `"-"` ou `":"` |
| 3 | Primeiro token alfanumérico (`"29C"` de `"29C - Reforma de Rede"`) |
| 4 | Match pelo nome do programa (normalizado, sem acentos) |
| 5 | Fallback: prefixo só com dígitos (`"29"` de `"29C"`) |

### Matching de PESE

```ts
matchPeseCode(panPeseCode: string, db: PeseDb) → string | null
```

1. Match exato case-insensitive.
2. Match parcial (contém ou está contido).

### Lookups de Orçamento

```ts
lookupBudget(db, empresa, tp, years) → number
```
Soma o orçamento de uma empresa+TP nos anos especificados.

```ts
lookupBudgetByYear(db, empresa, tp) → Record<string, number>
```
Retorna orçamento por ano para empresa+TP (usado nas tabelas anuais da `AnalyzedPan`).

```ts
lookupPeseByYear(db, peseCode) → Record<string, number>
```
Retorna orçamento PESE por ano, multiplicado por **`PESE_TAX_MULTIPLIER = 1.219512`** (multiplicador fiscal de 19,51%).

---

## `src/components/providers.tsx` — Providers de Contexto

```tsx
export function Providers({ children }: { children: React.ReactNode })
```

Compõe dois providers:

- **`ThemeProvider`** (`next-themes`): adiciona classe `.dark` ao `<html>`, detecta tema do sistema, desativa transição na troca.
- **`QueryClientProvider`** (`@tanstack/react-query`): instância única por mount via `useState`.

---

## `src/components/theme-toggle.tsx` — Alternância de Tema

```tsx
export function ThemeToggle()
```

Botão que alterna entre `light` e `dark` via `useTheme`. Usa estado `mounted` para evitar mismatch de hidratação (retorna `<div>` vazio antes do mount). Ícone: Lua em modo claro, Sol em modo escuro.

---

## `src/styles.css` — Design System

Usa oklch (espaço de cor perceptualmente uniforme). Todas as cores são CSS custom properties mapeadas para classes Tailwind via `@theme inline`.

### Paleta Dark Mode

| Token | Valor | Equivalente |
|---|---|---|
| `--background` | `oklch(0.09 0 0)` | `#121212` |
| `--canvas` | `oklch(0.11 0 0)` | Levemente acima do background |
| `--surface` | `oklch(0.14 0 0)` | Sidebar, header |
| `--card` | `oklch(0.15 0 0)` | Cards |
| `--primary` | `oklch(0.70 0.178 224)` | `#0aadff` (azul ciano) |
| `--accent` | `oklch(0.30 0.05 42)` | Laranja escuro para hover |
| `--status-ok` | `oklch(0.65 0.15 150)` | Verde |
| `--status-warn` | `oklch(0.78 0.16 85)` | Amarelo |
| `--gradient-brand` | `135deg oklch(0.55 0.22 228) → oklch(0.74 0.18 212)` | Azul profundo → `#0aadff` |

### Utilities Customizadas

| Classe | Efeito |
|---|---|
| `animate-pulse-slow` | Pulse de 3s suave |
| `animate-shimmer` | Efeito shimmer de loading |
| `hover-lift` | Eleva 2px com sombra no hover |
| `card-glow` | Borda e glow azul ciano no hover |
| `status-glow-ok/warn` | Box-shadow colorido nos indicadores de status |
| `text-gradient` | Texto com gradiente da marca |
| `btn-interactive` | Scale 1.02 hover / 0.98 active |
| `glass` | Fundo semi-transparente com backdrop-blur |
| `scrollbar-thin` | Scrollbar fina customizada |

---

## Constantes Importantes

| Constante | Valor | Onde |
|---|---|---|
| `PESE_TAX_MULTIPLIER` | `1.219512` | `budget-parser.ts` — aplicado ao orçamento PESE |
| `STOP_WORDS` | Set com termos do setor elétrico | `budget-parser.ts` — filtro no matching de tokens |

---

## Dependências Chave

| Pacote | Uso |
|---|---|
| `pdfjs-dist` | Extração de texto de PDFs |
| `xlsx-js-style` | Leitura e escrita de Excel com estilos |
| `next-themes` | Alternância dark/light |
| `framer-motion` | Animações de entrada/saída |
| `@tanstack/react-query` | Cache de dados (estrutura, não muito usado hoje) |
| `lucide-react` | Ícones |
| `tailwindcss` | Estilização utilitária |
