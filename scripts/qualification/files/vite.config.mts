import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import desktop from "../../../apps/desktop/vite.config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop");

// Production transformations/chunks, but an explicit fixture adapter entry.
// Never used by the product build, and never enables IPC.
export default mergeConfig(
  desktop,
  defineConfig({
    root,
    plugins: [
      {
        name: "qualification-fixture-entry",
        enforce: "pre",
        load(id) {
          if (id.replaceAll("\\", "/") !== `${root.replaceAll("\\", "/")}/src/main.tsx`)
            return null;
          return `import {createRoot} from 'react-dom/client';
import {App} from './App';
import {createPreviewApi} from './lib/preview-bridge';
import {runWorkerBenchmark} from '../../../scripts/qualification/files/worker-benchmark';
import {runFilesWorkflows} from '../../../scripts/qualification/files/workflows';
import './index.css';
window.__runQualificationBenchmark=runWorkerBenchmark;
window.__runQualificationWorkflows=runFilesWorkflows;
const preview = 'settings-files';
const base = createPreviewApi(preview);
const providedPath = 'tf/custom/qualification/cfg/provided.cfg';
const providedText = '// Read-only disposable pack fixture\\nsensitivity 2\\n';
const fixtureHash = 'a'.repeat(64);
const api = new Proxy(base, {get(target,key) {
  if (key === 'readProfileFile') return async (path,...args) => path === providedPath
    ? {path,text:providedText,sha256:fixtureHash,binary:false,source:{...await base.getFilesContext(),sha256:fixtureHash,librarySha256:fixtureHash}}
    : base.readProfileFile(path,...args);
  const value = target[key];
  if (typeof value !== 'function') return value;
  return async (...args) => {
    const result = await value(...args);
    if (result && Array.isArray(result.files) && typeof result.id === 'string')
      return {...result,files:[...result.files,{path:providedPath,sha256:fixtureHash,storage:'exclusive'}]};
    return result;
  };
}});
createRoot(document.getElementById('root')).render(<App api={api} preview={preview} />);`;
        },
      },
    ],
    build: { outDir: path.resolve(root, "../../../execs-017-evidence/production-fixture") },
  }),
);
