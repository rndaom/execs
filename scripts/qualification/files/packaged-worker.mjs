import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function eventually(operation, description) {
  let failure;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      failure = error;
    }
    await pause(500);
  }
  throw new Error(`Timed out: ${description}`, { cause: failure });
}

async function cdpSession(application, environment, evidence) {
  const child = spawn(application, [], {
    env: {
      ...environment,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1",
    },
    windowsHide: true,
  });
  const log = createWriteStream(join(evidence, "application.log"));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let socket;
  try {
    const page = await eventually(async () => {
      const pages = await (await fetch("http://127.0.0.1:9227/json/list")).json();
      return pages.find((entry) => entry.type === "page" && entry.url.includes("tauri.localhost"));
    }, "packaged WebView2 CDP target");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, reject) => {
      socket.addEventListener("open", done, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let counter = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(event.data);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      clearTimeout(request.timeout);
      if (response.error) request.reject(new Error(JSON.stringify(response.error)));
      else request.done(response.result);
    });
    const command = (method, params = {}) =>
      new Promise((done, reject) => {
        const id = ++counter;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, 30000);
        pending.set(id, { done, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    return {
      async evaluate(expression) {
        const result = await command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      },
      async screenshot() {
        return (await command("Page.captureScreenshot", { format: "png" })).data;
      },
      async close() {
        socket.close();
        child.kill();
        log.end();
      },
    };
  } catch (error) {
    socket?.close();
    child.kill();
    log.end();
    throw error;
  }
}

async function webkitSession(application, environment, evidence) {
  const child = spawn(
    "tauri-driver",
    ["--port", "4444", "--native-port", "4445", "--native-host", "127.0.0.1"],
    { env: environment },
  );
  const log = createWriteStream(join(evidence, "driver.log"));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const request = async (route, body, method = "POST") => {
    const response = await fetch(`http://127.0.0.1:4444${route}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const value = await response.json();
    if (!response.ok || value.value?.error) throw new Error(JSON.stringify(value));
    return value.value;
  };
  let session;
  try {
    await eventually(
      async () => (await fetch("http://127.0.0.1:4444/status")).ok,
      "WebKit driver startup",
    );
    session = (
      await request("/session", {
        capabilities: {
          alwaysMatch: { "tauri:options": { application }, timeouts: { script: 30000 } },
        },
      })
    ).sessionId;
    return {
      async evaluate(expression) {
        const result = await request(`/session/${session}/execute/async`, {
          script: `const done=arguments[arguments.length-1]; Promise.resolve(${expression}).then(value=>done({value}),error=>done({error:String(error)}));`,
          args: [],
        });
        if (result.error) throw new Error(result.error);
        return result.value;
      },
      async screenshot() {
        return request(`/session/${session}/screenshot`, undefined, "GET");
      },
      async close() {
        await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
        child.kill();
        log.end();
      },
    };
  } catch (error) {
    child.kill();
    log.end();
    throw error;
  }
}

/** Actual installed binary, real custom origin/CSP, synthetic worker payload only. */
export async function qualifyPackagedWorker(application, parentEnvironment, evidenceDirectory) {
  assert.equal(process.env.CI, "true", "Packaged worker qualification requires disposable CI");
  const evidence = resolve(evidenceDirectory);
  assert.ok(
    evidence.startsWith(`${resolve(process.env.RUNNER_TEMP)}${sep}`),
    "Evidence must stay in runner scratch",
  );
  mkdirSync(evidence, { recursive: true });
  const environment = {
    ...parentEnvironment,
    TAURI_WEBVIEW_AUTOMATION: "true",
    APPDATA: join(evidence, "roaming"),
    LOCALAPPDATA: join(evidence, "local"),
    XDG_DATA_HOME: join(evidence, "data"),
    XDG_CONFIG_HOME: join(evidence, "config"),
  };
  for (const directory of [
    environment.APPDATA,
    environment.LOCALAPPDATA,
    environment.XDG_DATA_HOME,
    environment.XDG_CONFIG_HOME,
  ])
    mkdirSync(directory, { recursive: true });
  const assets = resolve("apps/desktop/dist/assets");
  const workers = readdirSync(assets).filter((name) =>
    /^files-analysis\.worker-.*\.js$/.test(name),
  );
  assert.equal(workers.length, 1, "Exactly one production analysis worker required");
  const worker = workers[0];
  const sourceHash = createHash("sha256")
    .update(readFileSync(join(assets, worker)))
    .digest("hex");
  const session = await (process.platform === "win32" ? cdpSession : webkitSession)(
    application,
    environment,
    evidence,
  );
  try {
    const result = await session.evaluate(`(async()=>{
      const url=new URL(${JSON.stringify(`assets/${worker}`)},location.href).href;
      const identity='packaged-origin-worker';
      const started=performance.now();
      const outcome=await new Promise((resolve,reject)=>{
        const worker=new Worker(url,{type:'module'});
        const timer=setTimeout(()=>{worker.terminate();reject(Error('Packaged analysis worker timed out'));},15000);
        worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(Error(event.message||'Packaged worker error'));};
        worker.onmessage=event=>{clearTimeout(timer);worker.terminate();resolve(event.data);};
        worker.postMessage({profile:'disposable-qualification',identity,files:[{path:'tf/cfg/autoexec.cfg',text:'sensitivity 2\\nvoicemenu 0 0\\nfov_desired banana\\n'}]});
      });
      return {url,origin:location.origin,page:location.href,userAgent:navigator.userAgent,csp:[...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map(node=>node.content),durationMs:performance.now()-started,outcome};
    })()`);
    writeFileSync(
      join(evidence, "worker-result.json"),
      `${JSON.stringify({ application, workerAsset: worker, workerSha256: sourceHash, ...result }, null, 2)}\n`,
    );
    writeFileSync(
      join(evidence, "packaged-origin.png"),
      Buffer.from(await session.screenshot(), "base64"),
    );
    assert.equal(result.outcome.identity, "packaged-origin-worker");
    assert.ok(result.outcome.result, "Worker returned no lint result");
    assert.equal(result.outcome.error, undefined);
    assert.ok(
      result.outcome.result.findings.some((finding) =>
        /numeric|number|banana/i.test(JSON.stringify(finding)),
      ),
      "Worker did not produce the expected numeric finding",
    );
    assert.ok(result.origin.includes("tauri"), "Expected actual packaged Tauri origin");
    return result;
  } finally {
    await session.close();
  }
}
