"use client";

import { useRef, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import type { editor } from "monaco-editor";
import { Skeleton } from "@/components/ui/skeleton";

function EditorLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: "bicep" | "hcl" | "json" | "yaml";
  readOnly?: boolean;
  errorMarkers?: Array<{ line: number; message: string }>;
  height?: string;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  errorMarkers,
  height = "100%",
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback(
    (ed, monaco) => {
      editorRef.current = ed;

      // Register Bicep language
      if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === "bicep")) {
        monaco.languages.register({ id: "bicep" });
        monaco.languages.setMonarchTokensProvider("bicep", {
          keywords: [
            "param", "var", "resource", "module", "output", "if", "for",
            "in", "existing", "targetScope", "import", "type", "func",
          ],
          typeKeywords: ["string", "int", "bool", "object", "array"],
          operators: ["=", ":", "?", "!", "==", "!=", ">=", "<=", ">", "<", "&&", "||"],
          tokenizer: {
            root: [
              [/\/\/.*$/, "comment"],
              [/\/\*/, "comment", "@comment"],
              [/'[^']*'/, "string"],
              [/"[^"]*"/, "string"],
              [/\$\{/, "delimiter.bracket", "@interpolation"],
              [/@[a-zA-Z]+/, "annotation"],
              [/[a-zA-Z_]\w*/, {
                cases: {
                  "@keywords": "keyword",
                  "@typeKeywords": "type",
                  "@default": "identifier",
                },
              }],
              [/[{}()\[\]]/, "delimiter.bracket"],
              [/[0-9]+/, "number"],
            ],
            comment: [
              [/\*\//, "comment", "@pop"],
              [/./, "comment"],
            ],
            interpolation: [
              [/\}/, "delimiter.bracket", "@pop"],
              [/./, "string"],
            ],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Monaco's language-registration types are too generic to name here
        } as any);
      }

      // Register HCL language
      if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === "hcl")) {
        monaco.languages.register({ id: "hcl" });
        monaco.languages.setMonarchTokensProvider("hcl", {
          keywords: [
            "resource", "data", "variable", "output", "locals", "module",
            "terraform", "provider", "required_providers", "backend",
            "for_each", "count", "depends_on", "lifecycle", "dynamic",
          ],
          typeKeywords: ["string", "number", "bool", "list", "map", "object", "set", "tuple", "any"],
          operators: ["=", "==", "!=", ">=", "<=", ">", "<", "&&", "||", "?", ":"],
          tokenizer: {
            root: [
              [/#.*$/, "comment"],
              [/\/\/.*$/, "comment"],
              [/\/\*/, "comment", "@comment"],
              [/"[^"]*"/, "string"],
              [/<<-?\w+/, "string", "@heredoc"],
              [/\$\{/, "delimiter.bracket", "@interpolation"],
              [/[a-zA-Z_]\w*/, {
                cases: {
                  "@keywords": "keyword",
                  "@typeKeywords": "type",
                  "true|false": "keyword",
                  "null": "keyword",
                  "@default": "identifier",
                },
              }],
              [/[{}()\[\]]/, "delimiter.bracket"],
              [/[0-9]+(\.[0-9]+)?/, "number"],
            ],
            comment: [
              [/\*\//, "comment", "@pop"],
              [/./, "comment"],
            ],
            heredoc: [
              [/^\w+$/, "string", "@pop"],
              [/./, "string"],
            ],
            interpolation: [
              [/\}/, "delimiter.bracket", "@pop"],
              [/./, "string"],
            ],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Monaco's language-registration types are too generic to name here
        } as any);
      }

      // Set error markers
      if (errorMarkers?.length) {
        const model = ed.getModel();
        if (model) {
          monaco.editor.setModelMarkers(
            model,
            "validation",
            errorMarkers.map((e) => ({
              startLineNumber: e.line,
              endLineNumber: e.line,
              startColumn: 1,
              endColumn: 1000,
              message: e.message,
              severity: monaco.MarkerSeverity.Error,
            }))
          );
        }
      }
    },
    [errorMarkers]
  );

  return (
    <Editor
      height={height}
      language={language}
      theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
      value={value}
      onChange={(v) => onChange?.(v || "")}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        automaticLayout: true,
        tabSize: 2,
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
      }}
      onMount={handleMount}
      loading={<EditorLoadingSkeleton />}
    />
  );
}
