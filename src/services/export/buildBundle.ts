import type { Project } from '@savig/engine';
import { bytesToBase64 } from '../bytes';
import { MissingAssetError } from '../errors';
import { stableJson } from '../json';
import { renderProjectDocument, renderSvgDocument } from './renderDocument';

export type AssetBinaries = Record<string, Uint8Array>;

export interface ExportFiles {
  'index.html': string;
  'savig-runtime.js': string;
}

export function buildExportBundle(
  project: Project,
  binaries: AssetBinaries,
  runtimeJs: string,
): ExportFiles {
  const svg = project.scenes ? renderProjectDocument(project) : renderSvgDocument(project);

  // Collect base64 audio for every asset referenced by a clip (sorted for
  // byte-stability). Base64 inlining keeps the bundle openable via file://.
  const audioIds = Array.from(new Set(project.audioClips.map((c) => c.assetId))).sort();
  const audio: Record<string, string> = {};
  for (const id of audioIds) {
    const bytes = binaries[id];
    if (!bytes) throw new MissingAssetError(`Missing audio binary for asset "${id}".`);
    audio[id] = bytesToBase64(bytes);
  }

  const html =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n` +
    `<title>${escapeHtml(project.meta.name)}</title>\n` +
    `<style>html,body{margin:0;height:100%;background:#111}svg{display:block;width:100%;height:100%}</style>\n` +
    `</head>\n<body>\n${svg}\n` +
    `<script id="savig-project" type="application/json">${safeJson(project)}</script>\n` +
    `<script id="savig-audio" type="application/json">${safeJson(audio)}</script>\n` +
    `<script src="savig-runtime.js"></script>\n` +
    `<script>SavigRuntime.create({\n` +
    `  svg: document.querySelector('svg'),\n` +
    `  project: JSON.parse(document.getElementById('savig-project').textContent),\n` +
    `  audio: JSON.parse(document.getElementById('savig-audio').textContent)\n` +
    `});</script>\n</body>\n</html>\n`;

  return { 'index.html': html, 'savig-runtime.js': runtimeJs };
}

// Escape '<' so an embedded "</script>" (or "<!--") in any string value can't
// break out of the <script> block. JSON.parse decodes < back to '<', so
// the bundle reads identical data.
function safeJson(value: unknown): string {
  return stableJson(value).replace(/</g, '\\u003c');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
