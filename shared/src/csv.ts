/**
 * Reading test case spreadsheets saved as CSV.
 *
 * UAT and Regression templates:
 *   Test Case ID, Test Case Name, Description, Pre-condition, Question,
 *   Details to Validate, Expected Result
 * Each row is one step. Rows are grouped into test cases by their ID: REPORT1.0,
 * REPORT1.1 and REPORT1.2 are steps 1, 2 and 3 of test case REPORT1.
 *
 * SIT template:
 *   Test Case ID, System, Import via, Import Definition, Test Description, Expected Results
 * Like UAT, each row is one step, grouped into test cases by ID. The step keeps
 * the whole Test Description (numbered instructions included) and its Expected
 * Results; the test case is named after the Import Definition. Older SIT files
 * without a Test Case ID still work: each row becomes a test case and its
 * numbered lines become steps. Columns for results
 * (Actual Results, Pass/Fail, Test Performer, Comments) are ignored, because
 * results are recorded in TestScript during a run.
 */

/** Parse CSV text (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // byte-order mark from Excel

  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type ImportFormat = 'uat' | 'sit';

export interface ImportedStep {
  ref: string | null;
  action: string;
  expectedResult: string | null;
}

export interface ImportedCase {
  ref: string | null;
  name: string;
  description: string | null;
  steps: ImportedStep[];
}

export interface ParsedImport {
  format: ImportFormat | null;
  cases: ImportedCase[];
  /** Problems with individual rows. The rest of the file can still be imported. */
  warnings: string[];
  /** A problem with the whole file; nothing can be imported. */
  error: string | null;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

const UAT_COLUMNS = {
  id: 'test case id',
  name: 'test case name',
  description: 'description',
  precondition: 'pre condition',
  question: 'question',
  details: 'details to validate',
  expected: 'expected result',
} as const;

export const MAX_IMPORT_CASES = 500;
export const MAX_IMPORT_STEPS = 200;

function detect(headers: string[]): ImportFormat | null {
  const set = new Set(headers.map(norm));
  if (set.has(UAT_COLUMNS.id) && set.has(UAT_COLUMNS.question)) return 'uat';
  if (set.has('import definition') && set.has('test description')) return 'sit';
  return null;
}

/** Split "REPORT1.2" into test case "REPORT1" and step number 2. */
export function splitRef(id: string): { caseRef: string; step: number | null } {
  const m = /^(.*?)\.(\d+)$/.exec(id.trim());
  if (m && m[1]) return { caseRef: m[1], step: Number(m[2]) };
  return { caseRef: id.trim(), step: null };
}

export function parseImport(text: string): ParsedImport {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (headerIndex < 0) return { format: null, cases: [], warnings: [], error: 'The file is empty.' };
  const headers = rows[headerIndex];
  const format = detect(headers);
  if (!format) {
    return {
      format: null,
      cases: [],
      warnings: [],
      error: 'The column headings don\'t match a template. Use the UAT, Regression or SIT template and keep its first row as it is.',
    };
  }
  if (format === 'sit') return parseSit(rows, headerIndex);

  const col = (key: keyof typeof UAT_COLUMNS) => headers.findIndex((h) => norm(h) === UAT_COLUMNS[key]);
  const idx = Object.fromEntries(Object.keys(UAT_COLUMNS).map((k) => [k, col(k as keyof typeof UAT_COLUMNS)])) as Record<
    keyof typeof UAT_COLUMNS,
    number
  >;
  const get = (row: string[], key: keyof typeof UAT_COLUMNS) => (idx[key] >= 0 ? (row[idx[key]] ?? '').trim() : '');

  const warnings: string[] = [];
  const groups = new Map<
    string,
    { ref: string; name: string; description: string; precondition: string; steps: Array<ImportedStep & { order: number; row: number }> }
  >();

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const line = headerIndex + i + 2; // as numbered in a spreadsheet
    if (row.every((c) => c.trim() === '')) return;
    const id = get(row, 'id');
    if (!id) {
      warnings.push(`Row ${line} has no Test Case ID, so it was skipped.`);
      return;
    }
    const question = get(row, 'question');
    const details = get(row, 'details');
    if (!question && !details) {
      warnings.push(`Row ${line} (${id}) has no Question or Details to Validate, so it was skipped.`);
      return;
    }
    const { caseRef, step } = splitRef(id);
    const key = caseRef.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = {
        ref: caseRef,
        name: get(row, 'name'),
        description: get(row, 'description'),
        precondition: get(row, 'precondition'),
        steps: [],
      };
      groups.set(key, group);
    } else {
      const name = get(row, 'name');
      if (name && group.name && name !== group.name) {
        warnings.push(`Row ${line} (${id}) has a different Test Case Name from earlier rows of ${caseRef}; the first one was used.`);
      }
      group.name ||= name;
      group.description ||= get(row, 'description');
      group.precondition ||= get(row, 'precondition');
    }
    if (group.steps.some((s) => s.ref?.toLowerCase() === id.toLowerCase())) {
      warnings.push(`Row ${line}: ${id} appears more than once; only the first was used.`);
      return;
    }
    const action = question && details ? `${question}\n\nDetails to validate: ${details}` : question || details;
    group.steps.push({
      ref: id,
      action,
      expectedResult: get(row, 'expected') || null,
      order: step ?? Number.MAX_SAFE_INTEGER,
      row: line,
    });
  });

  const cases: ImportedCase[] = [];
  for (const g of groups.values()) {
    if (cases.length >= MAX_IMPORT_CASES) {
      warnings.push(`Only the first ${MAX_IMPORT_CASES} test cases were read. Split the file to upload the rest.`);
      break;
    }
    const steps = [...g.steps].sort((a, b) => a.order - b.order || a.row - b.row);
    if (steps.length > MAX_IMPORT_STEPS) warnings.push(`${g.ref} has more than ${MAX_IMPORT_STEPS} steps; the rest were left out.`);
    const description = [g.description, g.precondition && `Pre-condition: ${g.precondition}`].filter(Boolean).join('\n\n');
    cases.push({
      ref: g.ref,
      name: (g.name || g.ref).slice(0, 200),
      description: description || null,
      steps: steps.slice(0, MAX_IMPORT_STEPS).map(({ ref, action, expectedResult }) => ({ ref, action, expectedResult })),
    });
  }
  if (cases.length === 0 && warnings.length === 0) warnings.push('The file has headings but no rows to import.');
  return { format, cases, warnings, error: null };
}

/** SIT rows: one test case each, with numbered lines in Test Description as steps. */
function parseSit(rows: string[][], headerIndex: number): ParsedImport {
  const headers = rows[headerIndex].map(norm);
  if (headers.includes('test case id')) return parseSitById(rows, headerIndex);
  const at = (name: string) => headers.indexOf(name);
  const c = {
    system: at('system'),
    via: at('import via'),
    definition: at('import definition'),
    test: at('test description'),
    expected: at('expected results') >= 0 ? at('expected results') : at('expected result'),
  };
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
  const warnings: string[] = [];
  const cases: ImportedCase[] = [];

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const line = headerIndex + i + 2;
    if (row.every((cell) => cell.trim() === '')) return;
    const text = get(row, c.test);
    if (!text) {
      warnings.push(`Row ${line} has no Test Description, so it was skipped.`);
      return;
    }
    if (cases.length >= MAX_IMPORT_CASES) {
      if (cases.length === MAX_IMPORT_CASES) warnings.push(`Only the first ${MAX_IMPORT_CASES} test cases were read. Split the file to upload the rest.`);
      return;
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const numbered = /^\d+[.)]\s+/;
    const intro = lines.filter((l) => !numbered.test(l)).join(' ');
    const stepLines = lines.filter((l) => numbered.test(l)).map((l) => l.replace(numbered, ''));
    const expected = get(row, c.expected) || null;
    const steps: ImportedStep[] = (stepLines.length ? stepLines : [text]).slice(0, MAX_IMPORT_STEPS).map((action, n, all) => ({
      ref: null,
      action,
      expectedResult: n === all.length - 1 ? expected : null,
    }));
    const details = [
      get(row, c.system) && `System: ${get(row, c.system)}`,
      get(row, c.via) && `Import via: ${get(row, c.via)}`,
      get(row, c.definition) && `Import definition: ${get(row, c.definition)}`,
    ].filter(Boolean).join('\n');
    const name = firstSentence(intro || stepLines[0] || text);
    cases.push({
      ref: null,
      name,
      description: [stepLines.length && intro !== name ? intro : '', details].filter(Boolean).join('\n\n') || null,
      steps,
    });
  });
  if (cases.length === 0 && warnings.length === 0) warnings.push('The file has headings but no rows to import.');
  return { format: 'sit', cases, warnings, error: null };
}

function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  const sentence = (m ? m[1] : text).trim();
  return sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
}

/** SIT rows with a Test Case ID: each row is a step, grouped like UAT. */
function parseSitById(rows: string[][], headerIndex: number): ParsedImport {
  const headers = rows[headerIndex].map(norm);
  const at = (name: string) => headers.indexOf(name);
  const c = {
    id: at('test case id'),
    system: at('system'),
    via: at('import via'),
    definition: at('import definition'),
    test: at('test description'),
    expected: at('expected results') >= 0 ? at('expected results') : at('expected result'),
  };
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
  const warnings: string[] = [];
  const groups = new Map<string, { ref: string; name: string; details: string; steps: Array<ImportedStep & { order: number; row: number }> }>();

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const line = headerIndex + i + 2;
    if (row.every((cell) => cell.trim() === '')) return;
    const id = get(row, c.id);
    if (!id) {
      warnings.push(`Row ${line} has no Test Case ID, so it was skipped.`);
      return;
    }
    const text = get(row, c.test).replace(/[ \t]+$/gm, '');
    if (!text) {
      warnings.push(`Row ${line} (${id}) has no Test Description, so it was skipped.`);
      return;
    }
    const { caseRef, step } = splitRef(id);
    const key = caseRef.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      const details = [
        get(row, c.system) && `System: ${get(row, c.system)}`,
        get(row, c.via) && `Import via: ${get(row, c.via)}`,
        get(row, c.definition) && `Import definition: ${get(row, c.definition)}`,
      ].filter(Boolean).join('\n');
      group = { ref: caseRef, name: get(row, c.definition) || get(row, c.system) || firstSentence(text), details, steps: [] };
      groups.set(key, group);
    }
    if (group.steps.some((st) => st.ref?.toLowerCase() === id.toLowerCase())) {
      warnings.push(`Row ${line}: ${id} appears more than once; only the first was used.`);
      return;
    }
    group.steps.push({ ref: id, action: text, expectedResult: get(row, c.expected) || null, order: step ?? Number.MAX_SAFE_INTEGER, row: line });
  });

  const cases: ImportedCase[] = [];
  for (const g of groups.values()) {
    if (cases.length >= MAX_IMPORT_CASES) {
      warnings.push(`Only the first ${MAX_IMPORT_CASES} test cases were read. Split the file to upload the rest.`);
      break;
    }
    const steps = [...g.steps].sort((a, b) => a.order - b.order || a.row - b.row);
    if (steps.length > MAX_IMPORT_STEPS) warnings.push(`${g.ref} has more than ${MAX_IMPORT_STEPS} steps; the rest were left out.`);
    cases.push({
      ref: g.ref,
      name: g.name.slice(0, 200),
      description: g.details || null,
      steps: steps.slice(0, MAX_IMPORT_STEPS).map(({ ref, action, expectedResult }) => ({ ref, action, expectedResult })),
    });
  }
  if (cases.length === 0 && warnings.length === 0) warnings.push('The file has headings but no rows to import.');
  return { format: 'sit', cases, warnings, error: null };
}
