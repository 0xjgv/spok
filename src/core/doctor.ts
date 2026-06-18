import path from 'node:path';
import { resolveSchema } from './artifact-graph/resolver.js';
import { resolveCurrentPlanningHomeSync, type PlanningHome } from './planning-home.js';
import {
  readProjectConfigWithDiagnostics,
  validateConfigRules,
  type ProjectConfigDiagnostic,
  type ProjectConfigFormat,
} from './project-config.js';

export interface DoctorOptions {
  json?: boolean;
}

export type DoctorStatus = 'ok' | 'warning' | 'invalid';

export interface DoctorReport {
  status: DoctorStatus;
  planningHome: {
    kind: PlanningHome['kind'];
    root: string;
  } | null;
  config: {
    path: string;
    format: ProjectConfigFormat;
  } | null;
  diagnostics: ProjectConfigDiagnostic[];
}

function relativeConfigPath(planningRoot: string, configPath: string): string {
  const relative = path.relative(planningRoot, configPath);
  return relative.length > 0 ? relative : configPath;
}

function statusForDiagnostics(diagnostics: ProjectConfigDiagnostic[]): DoctorStatus {
  if (diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
    return 'invalid';
  }
  if (diagnostics.some((diagnostic) => diagnostic.level === 'warning')) {
    return 'warning';
  }
  return 'ok';
}

function schemaDiagnostic(error: unknown, file?: string): ProjectConfigDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  return {
    level: 'error',
    message,
    path: 'schema',
    file,
    fix: 'Set schema to an available schema name, for example: schema = "spec-driven".',
  };
}

function ruleDiagnostics(
  rules: Record<string, string[]>,
  planningHome: PlanningHome,
  schemaName: string,
  file?: string
): ProjectConfigDiagnostic[] {
  const schema = resolveSchema(schemaName, planningHome.root);
  const artifactIds = new Set(schema.artifacts.map((artifact) => artifact.id));
  return validateConfigRules(rules, artifactIds, schemaName).map((message) => ({
    level: 'warning' as const,
    message,
    path: 'rules',
    file,
    fix: 'Remove unknown artifact rule keys or rename them to valid artifact IDs.',
  }));
}

export function buildDoctorReport(startPath = process.cwd()): DoctorReport {
  let planningHome: PlanningHome;
  try {
    planningHome = resolveCurrentPlanningHomeSync({
      startPath,
      allowImplicitRepoRoot: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostics: ProjectConfigDiagnostic[] = [{
      level: 'error',
      message,
      fix: 'Run `spok init` in this project before using Spok commands.',
    }];
    return {
      status: 'invalid',
      planningHome: null,
      config: null,
      diagnostics,
    };
  }

  const configResult = readProjectConfigWithDiagnostics(planningHome.root);
  const diagnostics = [...configResult.diagnostics];
  const configPath = configResult.configPath
    ? relativeConfigPath(planningHome.root, configResult.configPath)
    : undefined;

  if (configResult.config?.schema) {
    try {
      resolveSchema(configResult.config.schema, planningHome.root);
      if (configResult.config.rules) {
        diagnostics.push(
          ...ruleDiagnostics(
            configResult.config.rules,
            planningHome,
            configResult.config.schema,
            configPath
          )
        );
      }
    } catch (error) {
      diagnostics.push(schemaDiagnostic(error, configPath));
    }
  }

  return {
    status: statusForDiagnostics(diagnostics),
    planningHome: {
      kind: planningHome.kind,
      root: planningHome.root,
    },
    config: configResult.configPath && configResult.format
      ? {
          path: configPath ?? configResult.configPath,
          format: configResult.format,
        }
      : null,
    diagnostics,
  };
}

function printDiagnosticGroup(title: string, diagnostics: ProjectConfigDiagnostic[]): void {
  if (diagnostics.length === 0) return;

  console.log();
  console.log(`${title}:`);
  for (const diagnostic of diagnostics) {
    const location = diagnostic.path ? `${diagnostic.path}: ` : '';
    console.log(`- ${location}${diagnostic.message}`);
    if (diagnostic.fix) {
      console.log(`  Fix: ${diagnostic.fix}`);
    }
  }
}

function printDoctorText(report: DoctorReport): void {
  console.log('Spok Doctor');
  console.log();
  console.log(`Status: ${report.status}`);
  console.log(`Planning home: ${report.planningHome?.root ?? 'not found'}`);
  console.log(`Config: ${report.config?.path ?? 'not found'}`);

  const errors = report.diagnostics.filter((diagnostic) => diagnostic.level === 'error');
  const warnings = report.diagnostics.filter((diagnostic) => diagnostic.level === 'warning');
  printDiagnosticGroup('Errors', errors);
  printDiagnosticGroup('Warnings', warnings);

  if (report.diagnostics.length === 0) {
    console.log();
    console.log('No configuration issues found.');
  }
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const report = buildDoctorReport();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDoctorText(report);
  }

  if (report.status === 'invalid') {
    process.exitCode = 1;
  }
}
