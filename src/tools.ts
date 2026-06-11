import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { Parser } from "expr-eval";
import type { Skill } from "./skills.ts";

const exprParser = new Parser();

/** Evaluate a single arithmetic expression — safe (no eval), via expr-eval. */
const calculator = tool(
  ({ expression }) => {
    try {
      const result = exprParser.evaluate(expression);
      return String(result);
    } catch (err) {
      return `Error: could not evaluate "${expression}" (${(err as Error).message})`;
    }
  },
  {
    name: "calculator",
    description:
      "Evaluate a single arithmetic expression and return the numeric result. " +
      "Supports + - * / % ^, parentheses, and functions like sqrt, abs, min, max, round.",
    schema: z.object({
      expression: z.string().describe("The arithmetic expression, e.g. '1234 * 9'"),
    }),
  },
);

/** Return the current date and time. */
const currentTime = tool(
  () => {
    const now = new Date();
    return `${now.toISOString()} (local: ${now.toString()})`;
  },
  {
    name: "current_time",
    description: "Get the current date and time. Takes no arguments.",
    schema: z.object({}),
  },
);

/**
 * Build the tool set, including `load_skill` which closes over the loaded
 * skills so the model can pull a full SKILL.md body on demand.
 */
export function buildTools(skills: Skill[]): StructuredToolInterface[] {
  const byName = new Map(skills.map((s) => [s.name, s]));

  const loadSkill = tool(
    ({ name }) => {
      const skill = byName.get(name);
      if (!skill) {
        const available = [...byName.keys()].join(", ") || "(none)";
        return `Error: no skill named "${name}". Available skills: ${available}.`;
      }
      return skill.body;
    },
    {
      name: "load_skill",
      description:
        "Load the full instructions for a named skill before performing a task it covers. " +
        "Call this whenever a relevant skill is listed in the system prompt.",
      schema: z.object({
        name: z.string().describe("The skill name to load, e.g. 'poetry'"),
      }),
    },
  );

  return [calculator, currentTime, loadSkill];
}

export type AgentTool = StructuredToolInterface;
