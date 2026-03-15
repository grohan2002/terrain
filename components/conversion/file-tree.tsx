"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BicepFiles } from "@/lib/types";

interface FileTreeProps {
  files: BicepFiles;
  entryPoint: string;
  selectedFile: string;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const p of paths.sort()) {
    const parts = p.split("/");
    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      let node = current.find((n) => n.name === part && n.isDir === !isLast);
      if (!node) {
        // For intermediate parts, also check for directory
        if (!isLast) {
          node = current.find((n) => n.name === part && n.isDir);
        }
        if (!node) {
          node = {
            name: part,
            path: currentPath,
            isDir: !isLast,
            children: [],
          };
          current.push(node);
        }
      }
      current = node.children;
    }
  }

  return root;
}

function TreeItem({
  node,
  entryPoint,
  selectedFile,
  onSelectFile,
  depth,
}: {
  node: TreeNode;
  entryPoint: string;
  selectedFile: string;
  onSelectFile: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isEntry = node.path === entryPoint;
  const isSelected = node.path === selectedFile;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 px-1 py-0.5 text-xs hover:bg-muted/50 rounded"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-3 w-3 shrink-0 text-blue-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                entryPoint={entryPoint}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={cn(
        "flex w-full items-center gap-1 px-1 py-0.5 text-xs rounded transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      <File className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      {isEntry && <Star className="h-3 w-3 shrink-0 text-yellow-500 fill-yellow-500" />}
    </button>
  );
}

export function FileTree({ files, entryPoint, selectedFile, onSelectFile }: FileTreeProps) {
  const paths = useMemo(() => Object.keys(files), [files]);
  const tree = useMemo(() => buildTree(paths), [paths]);

  return (
    <div className="flex flex-col h-full overflow-auto py-1">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          entryPoint={entryPoint}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          depth={0}
        />
      ))}
    </div>
  );
}
