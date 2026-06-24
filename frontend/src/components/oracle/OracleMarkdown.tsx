"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface OracleMarkdownProps {
  content: string;
}

export function OracleMarkdown({ content }: OracleMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        strong: ({ children }) => (
          <span className="font-semibold text-foreground">{children}</span>
        ),
        em: ({ children }) => <span className="italic">{children}</span>,
        p: ({ children }) => (
          <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
        ),
        h1: ({ children }) => (
          <h1 className="font-semibold text-base mt-3 mb-1 text-foreground">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="font-semibold text-sm mt-3 mb-1 text-foreground">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="font-semibold text-sm mt-3 mb-1 text-foreground">{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside space-y-1 mb-2 ml-2">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside space-y-1 mb-2 ml-2">{children}</ol>
        ),
        li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
        // react-markdown v9+ tidak lagi kirim prop "inline" — code block (```)
        // otomatis dibungkus <pre>, jadi <pre> di-style senada agar tidak polos.
        pre: ({ children }) => (
          <pre className="bg-muted rounded-lg p-2 my-2 overflow-x-auto text-xs">{children}</pre>
        ),
        code: ({ children }) => (
          <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>
        ),
        hr: () => <hr className="my-3 border-border" />,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary pl-3 my-2 text-muted-foreground italic text-sm">
            {children}
          </blockquote>
        ),
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs border-collapse w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border px-2 py-1 text-left font-semibold bg-muted">{children}</th>
        ),
        td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
