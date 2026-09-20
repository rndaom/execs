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
import './index.css';
const preview = 'settings-files';
createRoot(document.getElementById('root')).render(<App api={createPreviewApi(preview)} preview={preview} />);`;
        },
      },
    ],
    build: { outDir: path.resolve(root, "../../../execs-017-evidence/production-fixture") },
  }),
);
