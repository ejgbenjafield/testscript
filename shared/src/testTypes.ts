/**
 * Test area types. Each one matches a CSV template, and decides which fields
 * its test cases and steps use, in what order and with what labels.
 */
export const TEST_TYPES = ['uat', 'regression', 'sit'] as const;
export type TestType = (typeof TEST_TYPES)[number];

/** Test case fields that a template can use, besides the name. */
export type CaseFieldKey = 'ref' | 'description' | 'precondition' | 'system' | 'importVia' | 'importDefinition';
/** Step fields that a template can use. `action` is always there. */
export type StepFieldKey = 'action' | 'details' | 'expectedResult';

export interface TemplateDefinition {
  type: TestType;
  label: string;
  summary: string;
  /** The template file offered for download. */
  file: string;
  /** Test case fields, in order, with the template's column names. */
  caseFields: Array<{ key: CaseFieldKey; label: string; multiline: boolean }>;
  /** Step fields, in order, with the template's column names. */
  stepFields: Array<{ key: StepFieldKey; label: string }>;
  /** The CSV columns, in order, as they appear in the template. */
  columns: string[];
}

const uatLike = (type: 'uat' | 'regression', label: string, summary: string, file: string): TemplateDefinition => ({
  type,
  label,
  summary,
  file,
  caseFields: [
    { key: 'ref', label: 'Test Case ID', multiline: false },
    { key: 'description', label: 'Description', multiline: true },
    { key: 'precondition', label: 'Pre-condition', multiline: true },
  ],
  stepFields: [
    { key: 'action', label: 'Question' },
    { key: 'details', label: 'Details to Validate' },
    { key: 'expectedResult', label: 'Expected Result' },
  ],
  columns: ['Test Case ID', 'Test Case Name', 'Description', 'Pre-condition', 'Question', 'Details to Validate', 'Expected Result'],
});

export const TEMPLATES: Record<TestType, TemplateDefinition> = {
  uat: uatLike('uat', 'UAT', 'User acceptance testing: business checks with a question, what to validate and the expected result.', 'UAT_template.csv'),
  regression: uatLike(
    'regression',
    'Regression',
    'Re-checks that existing behaviour still works after a change. Same fields as UAT.',
    'Regression_template.csv',
  ),
  sit: {
    type: 'sit',
    label: 'SIT',
    summary: 'System integration testing: checks on a system and import, with a test description and expected results.',
    file: 'SIT_template.csv',
    caseFields: [
      { key: 'ref', label: 'Test Case ID', multiline: false },
      { key: 'system', label: 'System', multiline: false },
      { key: 'importVia', label: 'Import via', multiline: false },
      { key: 'importDefinition', label: 'Import Definition', multiline: false },
    ],
    stepFields: [
      { key: 'action', label: 'Test Description' },
      { key: 'expectedResult', label: 'Expected Results' },
    ],
    columns: ['Test Case ID', 'System', 'Import via', 'Import Definition', 'Test Description', 'Expected Results'],
  },
};

export function templateFor(type: TestType | null | undefined): TemplateDefinition {
  return TEMPLATES[type ?? 'uat'] ?? TEMPLATES.uat;
}

/** Which CSV layout a test area of this type accepts. */
export function importFormatFor(type: TestType): 'uat' | 'sit' {
  return type === 'sit' ? 'sit' : 'uat';
}
