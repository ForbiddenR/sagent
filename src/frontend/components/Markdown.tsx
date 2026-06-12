import type { ReactNode } from "react";

export function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function MarkdownMessage({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  let codeBlock: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="mb-2 last:mb-0">
        {renderInlineMarkdown(paragraph.join(" "))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
        {list.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  const flushTable = () => {
    if (table.length === 0) return;
    const header = table[0];
    const rows = table.slice(2);
    blocks.push(
      <div key={`table-${blocks.length}`} className="mb-2 overflow-x-auto last:mb-0">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              {header?.map((cell, i) => (
                <th key={i} className="border border-zinc-300 px-2 py-1 text-left font-semibold dark:border-zinc-700">
                  {renderInlineMarkdown(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">
                    {renderInlineMarkdown(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = [];
  };

  const flushCodeBlock = () => {
    if (codeBlock.length === 0) return;
    blocks.push(
      <pre key={`code-${blocks.length}`} className="mb-2 overflow-x-auto rounded bg-black/5 p-2 text-xs last:mb-0 dark:bg-white/5">
        <code>{codeBlock.join("\n")}</code>
      </pre>,
    );
    codeBlock = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      flushTable();
      if (inCodeBlock) {
        flushCodeBlock();
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeBlock.push(line);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    const bullet = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
    const indentedLine = line.match(/^\s{4,}(.+)$/);
    const tableRow = trimmed.match(/^\|(.+)\|$/);

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (tableRow) {
      flushParagraph();
      flushList();
      const cells = tableRow[1]!.split("|").map((c) => c.trim());
      table.push(cells);
      continue;
    }

    if (heading) {
      flushParagraph();
      flushList();
      flushTable();
      const level = heading[1]!.length;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      blocks.push(
        <Tag key={`h-${blocks.length}`} className="mb-2 mt-1 font-semibold first:mt-0">
          {renderInlineMarkdown(heading[2]!)}
        </Tag>,
      );
      continue;
    }

    if (bullet) {
      flushParagraph();
      flushTable();
      list.push(bullet[1]!);
      continue;
    }

    if (indentedLine) {
      flushParagraph();
      flushTable();
      list.push(indentedLine[1]!);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushTable();
  flushCodeBlock();

  return <>{blocks}</>;
}
