---
version: 0.1.0
---

# Multi-Language Guide

Configure Spok to generate artifacts in languages other than English.

## Quick Setup

Add a language instruction to your `spok/config.toml`:

```toml
schema = "spec-driven"

context = """
Language: Portuguese (pt-BR)
All artifacts must be written in Brazilian Portuguese.

# Your other project context below...
Tech stack: TypeScript, React, Node.js
"""
```

That's it. All generated artifacts will now be in Portuguese.

## Language Examples

### Portuguese (Brazil)

```toml
context = """
Language: Portuguese (pt-BR)
All artifacts must be written in Brazilian Portuguese.
"""
```

### Spanish

```toml
context = """
Idioma: Español
Todos los artefactos deben escribirse en español.
"""
```

### Chinese (Simplified)

```toml
context = """
语言：中文（简体）
所有产出物必须用简体中文撰写。
"""
```

### Japanese

```toml
context = """
言語：日本語
すべての成果物は日本語で作成してください。
"""
```

### French

```toml
context = """
Langue : Français
Tous les artefacts doivent être rédigés en français.
"""
```

### German

```toml
context = """
Sprache: Deutsch
Alle Artefakte müssen auf Deutsch verfasst werden.
"""
```

## Tips

### Handle Technical Terms

Decide how to handle technical terminology:

```toml
context = """
Language: Japanese
Write in Japanese, but:
- Keep technical terms like "API", "REST", "GraphQL" in English
- Code examples and file paths remain in English
"""
```

### Combine with Other Context

Language settings work alongside your other project context:

```toml
schema = "spec-driven"

context = """
Language: Portuguese (pt-BR)
All artifacts must be written in Brazilian Portuguese.

Tech stack: TypeScript, React 18, Node.js 20
Database: PostgreSQL with Prisma ORM
"""
```

## Verification

To verify your language config is working:

```bash
# Check the instructions - should show your language context
spok instructions proposal --change my-change

# Output will include your language context
```

## Related Documentation

- [Customization Guide](./customization.md) - Project configuration options
- [Workflows Guide](./workflows.md) - Full workflow documentation
