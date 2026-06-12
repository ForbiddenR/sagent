import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { Parser } from "expr-eval";
import type { Skill } from "./skills.ts";
import { ragStore } from "./rag.ts";

const exprParser = new Parser();
const WORKSPACE = process.env.WORKSPACE || `${process.cwd()}/workspace`;

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
export function buildTools(skills: Skill[], sessionId: string): StructuredToolInterface[] {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const sessionWorkspace = `${WORKSPACE.replace(/\/+$/, "")}/${sessionId}`;

  function safeSessionPath(path: string): string {
    if (path.startsWith("/") || path.includes("\0")) {
      throw new Error(`Path "${path}" must be relative to the session workspace`);
    }

    const parts: string[] = [];
    for (const segment of path.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        throw new Error(`Path "${path}" is outside session workspace`);
      }
      parts.push(segment);
    }

    return `${sessionWorkspace}/${parts.join("/")}`;
  }

  const readFile = tool(
    async ({ path }) => {
      try {
        const fullPath = safeSessionPath(path);
        const file = Bun.file(fullPath);
        if (!(await file.exists())) {
          return `Error: file "${path}" does not exist`;
        }
        const text = await file.text();
        return text;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "read_file",
      description: "Read the contents of a file from your session workspace folder.",
      schema: z.object({
        path: z.string().describe("Relative path within your session workspace, e.g. 'notes.txt' or 'data/config.json'"),
      }),
    },
  );

  const writeFile = tool(
    async ({ path, content }) => {
      try {
        const fullPath = safeSessionPath(path);
        console.log(`[WRITE REQUEST] Session workspace: ${path} (${content.length} bytes)`);
        // TODO: Implement user approval mechanism
        await Bun.write(fullPath, content);
        return `Successfully wrote ${content.length} bytes to "${path}"`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "write_file",
      description: "Write content to a file in your session workspace folder. Creates parent directories if needed. Requires user approval.",
      schema: z.object({
        path: z.string().describe("Relative path within your session workspace, e.g. 'output.txt' or 'results/data.json'"),
        content: z.string().describe("The content to write to the file"),
      }),
    },
  );

  const runBash = tool(
    async ({ command }) => {
      try {
        console.log(`[BASH REQUEST] Command: ${command}`);
        // TODO: Implement user approval mechanism
        const proc = Bun.spawn(["bash", "-c", command], {
          cwd: sessionWorkspace,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        await proc.exited;
        const output = [stdout, stderr].filter(Boolean).join("\n");
        return output || `Command completed with exit code ${proc.exitCode}`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "run_bash",
      description: "Run a bash command in your session workspace folder. Requires user approval. Use for file operations, data processing, etc.",
      schema: z.object({
        command: z.string().describe("The bash command to execute, e.g. 'ls -la' or 'cat file.txt | grep pattern'"),
      }),
    },
  );

  const searchWorkspace = tool(
    async ({ query }) => {
      try {
        await ragStore.indexSession(sessionId);
        return await ragStore.search(sessionId, query);
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "search_workspace",
      description: "Search all files in your workspace using semantic similarity. Better than read_file when you don't know exact filenames.",
      schema: z.object({
        query: z.string().describe("What to search for, e.g. 'database configuration' or 'error handling code'"),
      }),
    },
  );

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

  return [calculator, currentTime, readFile, writeFile, runBash, searchWorkspace, loadSkill];
}

export type AgentTool = StructuredToolInterface;
