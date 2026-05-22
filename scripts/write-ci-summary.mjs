import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportsDir = path.join(root, 'reports');

const outcomes = {
  unit: process.env.UNIT_OUTCOME || 'unknown',
  build: process.env.BUILD_OUTCOME || 'unknown',
  playwright: process.env.PLAYWRIGHT_INSTALL_OUTCOME || 'unknown',
  e2e: process.env.E2E_OUTCOME || 'unknown',
};

const unitReport = readJson(path.join(reportsDir, 'unit.json'));
const e2eReport = readJson(path.join(reportsDir, 'e2e.json'));
const coverageSummary = readJson(path.join(root, 'coverage', 'coverage-summary.json'));
const buildLog = readText(path.join(reportsDir, 'build.log'));

const rows = [
  {
    check: 'Unit tests',
    status: statusFor(outcomes.unit, unitReport?.success === false),
    result: unitResult(unitReport),
    coverage: coverageResult(coverageSummary),
  },
  {
    check: 'Build',
    status: statusFor(outcomes.build),
    result: outcomes.build === 'success' ? 'Build completed' : 'See build logs',
    coverage: '-',
  },
  {
    check: 'Playwright browser',
    status: statusFor(outcomes.playwright),
    result: outcomes.playwright === 'success' ? 'Chromium installed' : 'Browser install failed',
    coverage: '-',
  },
  {
    check: 'E2E tests',
    status: statusFor(outcomes.e2e, e2eHasFailures(e2eReport)),
    result: e2eResult(e2eReport, outcomes.e2e),
    coverage: '-',
  },
];

const markdown = [
  '# CI Summary',
  '',
  '| Check | Status | Result | Coverage |',
  '|---|---:|---|---|',
  ...rows.map(row => `| ${cell(row.check)} | ${cell(row.status)} | ${cell(row.result)} | ${cell(row.coverage)} |`),
  '',
  ...failureDetails(),
].join('\n');

writeSummary(markdown);

if (hasFailedChecks()) {
  process.exitCode = 1;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function statusFor(outcome, reportFailed = false) {
  if (reportFailed) return 'FAIL';
  if (outcome === 'success') return 'PASS';
  if (outcome === 'failure') return 'FAIL';
  if (outcome === 'skipped') return 'SKIPPED';
  if (outcome === 'cancelled') return 'CANCELLED';
  return 'UNKNOWN';
}

function unitResult(report) {
  if (!report) return 'No unit report was generated';

  const total = report.numTotalTests ?? 0;
  const passed = report.numPassedTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  const parts = [`${passed}/${total} passed`];

  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);

  return parts.join(', ');
}

function coverageResult(summary) {
  const total = summary?.total;
  if (!total) return 'No coverage report';

  return [
    `Lines ${pct(total.lines)}`,
    `Branches ${pct(total.branches)}`,
    `Functions ${pct(total.functions)}`,
    `Statements ${pct(total.statements)}`,
  ].join(', ');
}

function pct(metric) {
  if (!metric || typeof metric.pct !== 'number') return '-';
  return `${formatNumber(metric.pct)}%`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function e2eResult(report, outcome) {
  if (outcome === 'skipped') return 'Skipped because browser setup did not pass';
  if (!report) return 'No e2e report was generated';

  const stats = report.stats || {};
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  const total = passed + failed + flaky + skipped;
  const parts = [`${passed}/${total} passed`];

  if (failed) parts.push(`${failed} failed`);
  if (flaky) parts.push(`${flaky} flaky`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (report.errors?.length) parts.push(`${report.errors.length} setup error(s)`);

  return parts.join(', ');
}

function e2eHasFailures(report) {
  if (!report) return false;
  return Boolean(report.errors?.length || (report.stats?.unexpected ?? 0) > 0);
}

function failureDetails() {
  const sections = [];
  const unitFailures = getUnitFailures(unitReport);
  const e2eFailures = getE2eFailures(e2eReport);

  if (
    outcomes.unit !== 'success' ||
    outcomes.build !== 'success' ||
    outcomes.playwright !== 'success' ||
    outcomes.e2e !== 'success' ||
    unitFailures.length ||
    e2eFailures.length
  ) {
    sections.push('## Failure details', '');
  }

  if (unitFailures.length) {
    sections.push('### Unit tests', '');
    sections.push(...formatFailureList(unitFailures), '');
  } else if (outcomes.unit === 'failure') {
    sections.push('### Unit tests', '', '- Unit step failed before a parseable report was generated.', '');
  }

  if (outcomes.build === 'failure') {
    sections.push('### Build', '');
    sections.push(...formatCodeBlock(lastLines(buildLog, 30) || 'Build failed. See the workflow step logs.'), '');
  }

  if (outcomes.playwright === 'failure') {
    sections.push('### Playwright browser', '', '- Browser installation failed. See the workflow step logs.', '');
  }

  if (e2eFailures.length) {
    sections.push('### E2E tests', '');
    sections.push(...formatFailureList(e2eFailures), '');
  } else if (outcomes.e2e === 'failure') {
    sections.push('### E2E tests', '', '- E2E step failed before a parseable report was generated.', '');
  } else if (outcomes.e2e === 'skipped' && outcomes.playwright !== 'success') {
    sections.push('### E2E tests', '', '- E2E tests were skipped because Chromium was not installed.', '');
  }

  return sections;
}

function getUnitFailures(report) {
  if (!report?.testResults) return [];

  const failures = [];
  for (const fileResult of report.testResults) {
    for (const assertion of fileResult.assertionResults || []) {
      if (assertion.status !== 'failed') continue;

      const message = stripAnsi(assertion.failureMessages?.[0] || '').split('\n')[0];
      failures.push({
        title: assertion.fullName || assertion.title || 'Unnamed unit test',
        detail: message,
      });
    }
  }

  return failures;
}

function getE2eFailures(report) {
  if (!report) return [];

  const failures = [];
  for (const error of report.errors || []) {
    failures.push({
      title: 'Playwright setup',
      detail: stripAnsi(error.message || error.stack || 'Unknown setup error'),
    });
  }

  for (const spec of collectSpecs(report.suites || [])) {
    for (const test of spec.tests || []) {
      if (test.status !== 'unexpected') continue;

      const failedResult = [...(test.results || [])].reverse().find(result => result.status !== 'passed');
      const error = failedResult?.errors?.[0];
      failures.push({
        title: spec.titlePath.join(' > '),
        detail: stripAnsi(error?.message || error?.stack || test.status || 'Unexpected failure'),
      });
    }
  }

  return failures;
}

function collectSpecs(suites, parentTitles = []) {
  const specs = [];
  for (const suite of suites) {
    const suiteTitles = suite.title ? [...parentTitles, suite.title] : parentTitles;

    for (const spec of suite.specs || []) {
      specs.push({
        ...spec,
        titlePath: [...suiteTitles, spec.title],
      });
    }

    specs.push(...collectSpecs(suite.suites || [], suiteTitles));
  }
  return specs;
}

function formatFailureList(failures) {
  const visible = failures.slice(0, 10).map(failure => {
    const detail = firstLine(failure.detail);
    return detail ? `- ${failure.title}: ${detail}` : `- ${failure.title}`;
  });

  if (failures.length > 10) {
    visible.push(`- ...and ${failures.length - 10} more failure(s).`);
  }

  return visible;
}

function firstLine(text) {
  return String(text || '').split('\n').find(Boolean)?.trim() || '';
}

function lastLines(text, count) {
  return stripAnsi(text).trim().split('\n').slice(-count).join('\n');
}

function formatCodeBlock(text) {
  return ['```text', text, '```'];
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function hasFailedChecks() {
  return rows.some(row => row.status === 'FAIL' || row.status === 'SKIPPED' || row.status === 'CANCELLED' || row.status === 'UNKNOWN');
}

function writeSummary(text) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const output = `${text}\n`;

  if (summaryPath) {
    fs.appendFileSync(summaryPath, output);
    return;
  }

  console.log(output);
}
