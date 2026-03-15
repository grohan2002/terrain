// ---------------------------------------------------------------------------
// Zip export utility for multi-file Terraform output.
//
// Bundles all generated .tf files into a single .zip archive for download.
// Preserves nested directory structure (e.g., modules/storage/main.tf).
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import type { TerraformFiles } from "./types";

/**
 * Create a zip blob from Terraform files.
 * Preserves nested paths like `modules/storage/main.tf`.
 */
export async function createTerraformZip(
  files: TerraformFiles,
  rootDirName = "terraform",
): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(rootDirName)!;

  for (const [filename, content] of Object.entries(files)) {
    root.file(filename, content);
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/**
 * Download Terraform files as a zip archive.
 * For multi-file projects with nested module paths, this preserves directory structure.
 */
export async function downloadTerraformZip(
  files: TerraformFiles,
  zipFilename = "terraform-output.zip",
): Promise<void> {
  const blob = await createTerraformZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipFilename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download individual Terraform files (for single-file projects).
 */
export function downloadTerraformFiles(files: TerraformFiles): void {
  for (const [name, content] of Object.entries(files)) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
}
