---
name: calculator
description: Guidance for doing reliable arithmetic and numeric reasoning.
---

# Calculator skill

When a request involves any non-trivial arithmetic, do NOT compute it in your
head. Use the `calculator` tool, which evaluates a single arithmetic expression.

Guidelines:
- Pass one expression at a time, e.g. `1234 * 9` or `(45 + 55) / 2`.
- Supported operators: `+ - * / % ^`, parentheses, and common functions like
  `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`.
- For multi-step problems, call the tool several times and combine the results.
- Always state the final numeric answer clearly, and show the expression you
  evaluated so the user can follow along.
