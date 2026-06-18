import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readProjectConfig,
  readProjectConfigWithDiagnostics,
  validateConfigRules,
  suggestSchemas,
} from '../../src/core/project-config.js';

describe('project-config', () => {
  let tempDir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  function diagnosticMessages(): string[] {
    return readProjectConfigWithDiagnostics(tempDir).diagnostics.map((diagnostic) => diagnostic.message);
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spok-test-config-'));
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleWarnSpy.mockRestore();
  });

  describe('readProjectConfig', () => {
    describe('resilient parsing', () => {
      it('should parse complete valid config', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  Tech stack: TypeScript, React
  API style: RESTful
rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
  specs:
    - Use Given/When/Then format
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          context: 'Tech stack: TypeScript, React\nAPI style: RESTful\n',
          rules: {
            proposal: ['Include rollback plan', 'Identify affected teams'],
            specs: ['Use Given/When/Then format'],
          },
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should parse minimal config with schema only', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n');

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should parse flow self-learn when enabled', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
flow:
  self_learn: true
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          flow: {
            self_learn: true,
          },
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should parse flow self-learn when disabled', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
flow:
  self_learn: false
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          flow: {
            self_learn: false,
          },
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should return partial config when schema is invalid', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ""
context: Valid context here
rules:
  proposal:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          context: 'Valid context here',
          rules: {
            proposal: ['Valid rule'],
          },
        });
        expect(diagnosticMessages()).toContain('schema must be a non-empty string');
      });

      it('should return partial config when context is invalid', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: 123
rules:
  proposal:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            proposal: ['Valid rule'],
          },
        });
        expect(diagnosticMessages()).toContain('context must be a string');
      });

      it('should return partial config when rules is not an object', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: Valid context
rules: ["not", "an", "object"]
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          context: 'Valid context',
        });
        expect(diagnosticMessages()).toContain('rules must be an object');
      });

      it('should return partial config when flow is not an object', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
flow: true
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
        });
        expect(diagnosticMessages()).toContain('flow must be an object');
      });

      it('should return partial config when flow self_learn is not boolean', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
flow:
  self_learn: "yes"
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
        });
        expect(diagnosticMessages()).toContain('flow.self_learn must be boolean');
      });

      it('should diagnose missing schema when config has other fields', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.toml'),
          `[flow]
self_learn = true
`
        );

        const result = readProjectConfigWithDiagnostics(tempDir);

        expect(result.config).toEqual({
          flow: {
            self_learn: true,
          },
        });
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            level: 'error',
            message: 'schema is required',
            path: 'schema',
          })
        );
      });

      it('should diagnose unknown config keys without discarding valid fields', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.toml'),
          `schema = "spec-driven"
unknown = true

[flow]
self_learn = false
surprise = true
`
        );

        const result = readProjectConfigWithDiagnostics(tempDir);

        expect(result.config).toEqual({
          schema: 'spec-driven',
          flow: {
            self_learn: false,
          },
        });
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              level: 'warning',
              message: 'unknown config key unknown; ignoring it',
              path: 'unknown',
            }),
            expect.objectContaining({
              level: 'warning',
              message: 'unknown flow key flow.surprise; ignoring it',
              path: 'flow.surprise',
            }),
          ])
        );
      });

      it('should handle rules: null without aborting config parsing', () => {
        // YAML `rules:` with no value parses to null
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: Valid context
rules:
`
        );

        const config = readProjectConfig(tempDir);

        // Should still parse schema and context despite null rules
        expect(config).toEqual({
          schema: 'spec-driven',
          context: 'Valid context',
        });
        expect(diagnosticMessages()).toContain('rules must be an object');
      });

      it('should filter out invalid rules for specific artifact', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - Valid rule
  specs: "not an array"
  design:
    - Another valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            proposal: ['Valid rule'],
            design: ['Another valid rule'],
          },
        });
        expect(diagnosticMessages()).toContain('rules.specs must be an array of strings');
      });

      it('should filter out empty string rules', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - Valid rule
    - ""
    - Another valid rule
    - ""
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            proposal: ['Valid rule', 'Another valid rule'],
          },
        });
        expect(diagnosticMessages()).toContain('rules.proposal contains empty strings; ignoring them');
      });

      it('should skip artifact if all rules are empty strings', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - ""
    - ""
  specs:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            specs: ['Valid rule'],
          },
        });
      });

      it('should handle completely invalid YAML gracefully', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: [unclosed');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(diagnosticMessages().some((message) =>
          message.startsWith('Failed to parse spok/config.yaml:')
        )).toBe(true);
      });

      it('should handle completely invalid TOML gracefully', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.toml'), 'schema = "unclosed');

        const result = readProjectConfigWithDiagnostics(tempDir);

        expect(result.config).toBeNull();
        expect(result.format).toBe('toml');
        expect(result.diagnostics.some((diagnostic) =>
          diagnostic.message.startsWith('Failed to parse spok/config.toml:')
        )).toBe(true);
      });

      it('should warn when config is not a YAML object', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), '"just a string"');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(diagnosticMessages()).toContain('spok/config.yaml is not a valid YAML object');
      });

      it('should handle empty config file', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), '');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
      });
    });

    describe('context size limit enforcement', () => {
      it('should accept context under 50KB limit', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        const smallContext = 'a'.repeat(1000); // 1KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven\ncontext: "${smallContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(smallContext);
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });

      it('should reject context over 50KB limit', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        const largeContext = 'a'.repeat(51 * 1024); // 51KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven\ncontext: "${largeContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({ schema: 'spec-driven' });
        expect(config?.context).toBeUndefined();
        expect(diagnosticMessages()).toContain(
          'context is too large (51.0KB, limit: 50KB); ignoring context'
        );
      });

      it('should handle context exactly at 50KB limit', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        const exactContext = 'a'.repeat(50 * 1024); // Exactly 50KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven\ncontext: "${exactContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(exactContext);
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });

      it('should handle multi-byte UTF-8 characters in size calculation', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        // Unicode snowman is 3 bytes in UTF-8
        const contextWithUnicode = '☃'.repeat(18000); // ~54KB in UTF-8 (18000 * 3 bytes)
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  ${contextWithUnicode}
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBeUndefined();
        expect(diagnosticMessages().some((message) =>
          message.startsWith('context is too large')
        )).toBe(true);
      });
    });

    describe('config file precedence', () => {
      it('should prefer TOML over YAML when both exist', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.toml'),
          'schema = "spec-driven"\ncontext = "from toml"\n'
        );
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: custom-schema\ncontext: from yaml\n'
        );

        const result = readProjectConfigWithDiagnostics(tempDir);

        expect(result.config?.schema).toBe('spec-driven');
        expect(result.config?.context).toBe('from toml');
        expect(result.format).toBe('toml');
        expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
          'multiple Spok config files found; using spok/config.toml'
        );
      });

      it('should parse TOML flow self-learn when enabled', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.toml'),
          'schema = "spec-driven"\n\n[flow]\nself_learn = true\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          flow: {
            self_learn: true,
          },
        });
      });

      it('should parse TOML dotted flow self-learn key', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.toml'),
          'schema = "spec-driven"\nflow.self_learn = true\n'
        );

        const result = readProjectConfigWithDiagnostics(tempDir);

        expect(result.config).toEqual({
          schema: 'spec-driven',
          flow: {
            self_learn: true,
          },
        });
        expect(result.diagnostics).toEqual([]);
      });

      it('should prefer .yaml when both exist', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: spec-driven\ncontext: from yaml\n'
        );
        fs.writeFileSync(
          path.join(configDir, 'config.yml'),
          'schema: custom-schema\ncontext: from yml\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.schema).toBe('spec-driven');
        expect(config?.context).toBe('from yaml');
      });

      it('should use .yml when .yaml does not exist', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yml'),
          'schema: custom-schema\ncontext: from yml\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.schema).toBe('custom-schema');
        expect(config?.context).toBe('from yml');
      });

      it('should return null when no config file exists', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should return null when spok directory does not exist', () => {
        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });
    });

    describe('multi-line and special characters', () => {
      it('should preserve multi-line context', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  Line 1: Tech stack
  Line 2: API conventions
  Line 3: Testing approach
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(
          'Line 1: Tech stack\nLine 2: API conventions\nLine 3: Testing approach\n'
        );
      });

      it('should preserve special YAML characters in context', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  Special chars: : @ # $ % & * [ ] { }
  Quotes: "double" 'single'
  Symbols: < > | \\ /
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toContain('Special chars: : @ # $ % & * [ ] { }');
        expect(config?.context).toContain('"double"');
        expect(config?.context).toContain("'single'");
        expect(config?.context).toContain('Symbols: < > | \\ /');
      });

      it('should preserve special characters in rule strings', () => {
        const configDir = path.join(tempDir, 'spok');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - "Use <template> tags in docs"
    - "Reference @mentions and #channels"
    - "Follow {variable} naming"
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.rules?.proposal).toEqual([
          'Use <template> tags in docs',
          'Reference @mentions and #channels',
          'Follow {variable} naming',
        ]);
      });
    });
  });

  describe('validateConfigRules', () => {
    it('should return no warnings for valid artifact IDs', () => {
      const rules = {
        proposal: ['Rule 1'],
        specs: ['Rule 2'],
        design: ['Rule 3'],
      };
      const validIds = new Set(['proposal', 'specs', 'design', 'tasks']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toEqual([]);
    });

    it('should warn about unknown artifact IDs', () => {
      const rules = {
        proposal: ['Rule 1'],
        testplan: ['Rule 2'], // Invalid
        documentation: ['Rule 3'], // Invalid
      };
      const validIds = new Set(['proposal', 'specs', 'design', 'tasks']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('Unknown artifact ID in rules: "testplan"');
      expect(warnings[0]).toContain('Valid IDs for schema "spec-driven": design, proposal, specs, tasks');
      expect(warnings[1]).toContain('Unknown artifact ID in rules: "documentation"');
    });

    it('should return warnings for all unknown artifact IDs', () => {
      const rules = {
        invalid1: ['Rule 1'],
        invalid2: ['Rule 2'],
        invalid3: ['Rule 3'],
      };
      const validIds = new Set(['proposal', 'specs']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toHaveLength(3);
    });

    it('should handle empty rules object', () => {
      const rules = {};
      const validIds = new Set(['proposal', 'specs']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toEqual([]);
    });
  });

  describe('suggestSchemas', () => {
    const availableSchemas = [
      { name: 'spec-driven', isBuiltIn: true },
      { name: 'custom-workflow', isBuiltIn: false },
      { name: 'team-process', isBuiltIn: false },
    ];

    it('should suggest close matches using fuzzy matching', () => {
      const message = suggestSchemas('spec-drven', availableSchemas); // Missing 'i'

      expect(message).toContain("Schema 'spec-drven' not found");
      expect(message).toContain('Did you mean one of these?');
      expect(message).toContain('spec-driven (built-in)');
    });

    it('should suggest custom-workflow for workflow typo', () => {
      const message = suggestSchemas('custom-workflo', availableSchemas);

      expect(message).toContain('Did you mean one of these?');
      expect(message).toContain('custom-workflow');
    });

    it('should list all available schemas', () => {
      const message = suggestSchemas('nonexistent', availableSchemas);

      expect(message).toContain('Available schemas:');
      expect(message).toContain('Built-in: spec-driven');
      expect(message).toContain('Project-local: custom-workflow, team-process');
    });

    it('should handle case when no project-local schemas exist', () => {
      const builtInOnly = [
        { name: 'spec-driven', isBuiltIn: true },
      ];
      const message = suggestSchemas('invalid', builtInOnly);

      expect(message).toContain('Built-in: spec-driven');
      expect(message).toContain('Project-local: (none found)');
    });

    it('should include fix instruction', () => {
      const message = suggestSchemas('wrong-schema', availableSchemas);

      expect(message).toContain(
        'Fix: Edit spok/config.toml and set schema = "valid-schema-name"'
      );
    });

    it('should limit suggestions to top 3 matches', () => {
      const manySchemas = [
        { name: 'test-a', isBuiltIn: true },
        { name: 'test-b', isBuiltIn: true },
        { name: 'test-c', isBuiltIn: true },
        { name: 'test-d', isBuiltIn: true },
        { name: 'test-e', isBuiltIn: true },
      ];
      const message = suggestSchemas('test', manySchemas);

      // Should suggest at most 3
      const suggestionCount = (message.match(/test-/g) || []).length;
      expect(suggestionCount).toBeGreaterThanOrEqual(3);
      expect(suggestionCount).toBeLessThanOrEqual(3 + 5); // 3 in suggestions + 5 in "Available" list
    });

    it('should not suggest schemas with distance > 3', () => {
      const message = suggestSchemas('abcdefghijk', availableSchemas);

      // 'abcdefghijk' has large Levenshtein distance from all schemas
      expect(message).not.toContain('Did you mean');
      expect(message).toContain('Available schemas:');
    });
  });
});
