import { Project } from 'ts-morph';
import path from 'node:path';

const PKGS = ['engine', 'core', 'services', 'runtime', 'mcp'];
const SRC = path.resolve('src');
// map an absolute file path to its top-level src package, or null
const pkgOf = (abs) => {
  const rel = path.relative(SRC, abs);
  if (rel.startsWith('..')) return null;
  const top = rel.split(path.sep)[0];
  return PKGS.includes(top) ? top : null;
};

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });
let changed = 0;
for (const sf of project.getSourceFiles('src/**/*.{ts,tsx}')) {
  const fromPkg = pkgOf(sf.getFilePath()); // package the importer lives in (or null = ui)
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!spec.startsWith('.')) continue; // only relative imports
    const abs = path.resolve(path.dirname(sf.getFilePath()), spec);
    const toPkg = pkgOf(abs);
    if (!toPkg || toPkg === fromPkg) continue; // not cross-package
    // sub-path within the target package (e.g. runtime/runtimeSource.generated)
    const targetTop = path.join(SRC, toPkg);
    const sub = path.relative(targetTop, abs).replace(/\\/g, '/');
    const isIndex = sub === '' || sub === 'index' || sub === 'index.ts';
    const newSpec = isIndex ? `@savig/${toPkg}` : `@savig/${toPkg}/${sub.replace(/\.tsx?$/, '')}`;
    imp.setModuleSpecifier(newSpec);
    changed++;
  }
}
await project.save();
console.log(`Rewrote ${changed} cross-package imports.`);
