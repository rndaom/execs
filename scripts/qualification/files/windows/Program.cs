using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace FilesQualification;

// Disposable native engine host. It exposes no Tauri IPC or real profile state.
internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        if (args.Length < 5 || args.Length > 6) throw new ArgumentException("URL NEW_EVIDENCE_DIR WIDTH HEIGHT ZOOM [automate] required");
        var automate = args.Length == 6 && args[5] is "automate" or "capture";
        var captureOnly = args.Length == 6 && args[5] == "capture";
        if (automate && Environment.GetEnvironmentVariable("CI") != "true")
            throw new ArgumentException("Automated native input requires a disposable CI worker");
        var url = new Uri(args[0]);
        if (url.Scheme != "http" || url.Host != "127.0.0.1" || !url.Query.Contains("preview=settings-files"))
            throw new ArgumentException("Only loopback Files preview fixtures are accepted");
        var evidence = Path.GetFullPath(args[1]);
        if (Directory.Exists(evidence)) throw new ArgumentException("Evidence directory must be new");
        Directory.CreateDirectory(evidence);
        var width = int.Parse(args[2]);
        var height = int.Parse(args[3]);
        var zoom = double.Parse(args[4], System.Globalization.CultureInfo.InvariantCulture);
        var web = new WebView2 { Width = width, Height = height, ZoomFactor = zoom };
        var window = new Window
        {
            Title = "execs 0.1.7 isolated Files qualification",
            Content = web,
            SizeToContent = SizeToContent.WidthAndHeight
        };
        var watch = Stopwatch.StartNew();
        window.Loaded += async (_, _) =>
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(evidence, "webview-data"));
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) || target.Scheme != "http" || target.Host != "127.0.0.1")
                    e.Cancel = true;
            };
            web.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
            web.CoreWebView2.NavigationCompleted += async (_, e) =>
            {
                var viewport = await web.ExecuteScriptAsync("JSON.stringify({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,preview:!!document.querySelector('body')})");
                File.WriteAllText(Path.Combine(evidence, "host.json"), JsonSerializer.Serialize(new
                {
                    url = url.ToString(), width, height, zoom, browser = env.BrowserVersionString,
                    navigationSucceeded = e.IsSuccess, navigationMs = watch.ElapsedMilliseconds,
                    viewport, scope = "Native engine preview; not packaged Tauri/IPC or screen-reader certification"
                }, new JsonSerializerOptions { WriteIndented = true }));
                if (automate)
                {
                    try { await Qualify(window, web, evidence, captureOnly); }
                    catch (Exception error)
                    {
                        File.WriteAllText(Path.Combine(evidence, "failure.txt"), error.ToString());
                        File.WriteAllText(Path.Combine(evidence, "failure-dom.json"), await web.ExecuteScriptAsync("({active:document.activeElement?.outerHTML,body:document.body.innerText})"));
                        using (var picture = File.Create(Path.Combine(evidence, "failure.png")))
                            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, picture);
                        Environment.ExitCode = 1;
                    }
                    finally { window.Close(); }
                }
            };
            web.Source = url;
        };
        new Application().Run(window);
    }

    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern short VkKeyScan(char value);

    private static async Task Key(IntPtr window, byte key, byte modifier = 0, byte secondModifier = 0)
    {
        if (GetForegroundWindow() != window) throw new InvalidOperationException("Qualification window lost foreground; no input sent");
        if (modifier != 0) keybd_event(modifier, 0, 0, UIntPtr.Zero);
        if (secondModifier != 0) keybd_event(secondModifier, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 2, UIntPtr.Zero);
        if (secondModifier != 0) keybd_event(secondModifier, 0, 2, UIntPtr.Zero);
        if (modifier != 0) keybd_event(modifier, 0, 2, UIntPtr.Zero);
        await Task.Delay(150);
    }

    private static async Task Qualify(Window window, WebView2 web, string evidence, bool captureOnly)
    {
        for (var attempt = 0; attempt < 60; attempt++)
        {
            if (await web.ExecuteScriptAsync("!!document.querySelector('.cm-content')") == "true") break;
            await Task.Delay(500);
        }
        if (await web.ExecuteScriptAsync("!!document.querySelector('.cm-content')") != "true")
            throw new InvalidOperationException("Integrated Files editor was not rendered");
        if (captureOnly && web.ZoomFactor == 2)
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Emulation.setEmulatedMedia", "{\"features\":[{\"name\":\"prefers-reduced-motion\",\"value\":\"reduce\"}]}");
        await Task.Delay(1500);
        File.WriteAllText(Path.Combine(evidence, "display.json"), await web.ExecuteScriptAsync("({reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,buttonTransitions:[...document.querySelectorAll('button')].map(button=>({name:button.textContent,transitionDuration:getComputedStyle(button).transitionDuration})),viewport:{width:innerWidth,height:innerHeight}})"));
        using (var picture = File.Create(Path.Combine(evidence, "native-initial.png")))
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, picture);
        if (captureOnly) return;
        await web.ExecuteScriptAsync("window.__qualificationPaint=[]; document.addEventListener('keydown',()=>{const start=performance.now(); requestAnimationFrame(()=>requestAnimationFrame(()=>window.__qualificationPaint.push(performance.now()-start)));},true)");
        var handle = new WindowInteropHelper(window).Handle;
        window.Activate();
        SetForegroundWindow(handle);
        web.Focus();
        var observations = new List<string>();
        for (var attempt = 0; attempt < 100; attempt++)
        {
            await Key(handle, 0x09);
            observations.Add(await web.ExecuteScriptAsync("({tag:document.activeElement?.tagName,name:document.activeElement?.getAttribute('aria-label'),text:document.activeElement?.textContent?.slice(0,300)})"));
            if (await web.ExecuteScriptAsync("document.activeElement?.classList.contains('cm-content')") == "true") break;
        }
        File.WriteAllText(Path.Combine(evidence, "tab-navigation.json"), JsonSerializer.Serialize(observations));
        if (await web.ExecuteScriptAsync("document.activeElement?.classList.contains('cm-content')") != "true")
            throw new InvalidOperationException("Physical Tab never reached editor");
        await Key(handle, 0x46, 0x11);
        if (await web.ExecuteScriptAsync("!!document.querySelector('.cm-search input[name=search]')") != "true")
            throw new InvalidOperationException("Physical Ctrl+F did not open search");
        // NVDA reserves Escape for leaving focus mode. Its documented pass-next-key
        // gesture sends this Escape to CodeMirror instead of changing reader mode.
        await Key(handle, 0x71, 0x2D);
        await Key(handle, 0x1B);
        if (await web.ExecuteScriptAsync("document.activeElement?.classList.contains('cm-content')") != "true")
            throw new InvalidOperationException("Search close did not return focus to editor");
        await Key(handle, 0x47, 0x11, 0x12);
        if (await web.ExecuteScriptAsync("!!document.querySelector('input[name=line]')") != "true")
            throw new InvalidOperationException("Physical Ctrl+Alt+G did not open go-to-line");
        await Key(handle, 0x71, 0x2D);
        await Key(handle, 0x1B);
        await Key(handle, 0x1B);
        await Key(handle, 0x09);
        if (await web.ExecuteScriptAsync("document.activeElement?.classList.contains('cm-content')") == "true")
            throw new InvalidOperationException("Default Tab trapped focus in editor");
        await Key(handle, 0x09, 0x10);
        await Key(handle, 0x23, 0x11);
        await Key(handle, 0x0D);
        foreach (var character in "sensi")
        {
            var mapped = VkKeyScan(character);
            await Key(handle, (byte)(mapped & 0xff), (mapped & 0x100) != 0 ? (byte)0x10 : (byte)0);
        }
        await Key(handle, 0x20, 0x11);
        await Task.Delay(1000);
        var completion = await web.ExecuteScriptAsync("document.querySelector('.cm-tooltip-autocomplete')?.textContent ?? ''");
        File.WriteAllText(Path.Combine(evidence, "completion.json"), completion);
        if (!completion.Contains("sensitivity")) throw new InvalidOperationException("Command completion did not offer sensitivity");
        await Key(handle, 0x09);
        await Task.Delay(500);
        if (!(await web.ExecuteScriptAsync("document.querySelector('.cm-content')?.textContent")).Contains("sensitivity"))
            throw new InvalidOperationException("Tab did not accept command completion");
        await Key(handle, 0x1B);
        for (var sample = 0; sample < 20; sample++)
        {
            await Key(handle, 0x20, 0x11);
            await Task.Delay(200);
            await Key(handle, 0x1B);
        }
        File.WriteAllText(Path.Combine(evidence, "timing.json"), await web.ExecuteScriptAsync("window.__qualificationTiming"));
        if (await web.ExecuteScriptAsync("window.__qualificationTiming.completionMs.length >= 20") != "true")
            throw new InvalidOperationException("Insufficient distinct physical completion timing observations");
        await web.ExecuteScriptAsync("window.__qualificationPaint=[]");
        await Key(handle, 0x23, 0x11);
        await Key(handle, 0x0D);
        foreach (var character in "// paint latency sample abcdefghijklmnopqrstuvwxyz 0123456789")
        {
            var mapped = VkKeyScan(character);
            await Key(handle, (byte)(mapped & 0xff), (mapped & 0x100) != 0 ? (byte)0x10 : (byte)0);
        }
        File.WriteAllText(Path.Combine(evidence, "paint-latency.json"), await web.ExecuteScriptAsync("(()=>{const values=window.__qualificationPaint.toSorted((a,b)=>a-b);return {measurement:'physical keydown to second requestAnimationFrame; includes monitor frame interval',samples:values.length,p95ms:values[Math.max(0,Math.ceil(values.length*.95)-1)],values}})()"));
        await web.ExecuteScriptAsync("window.__runQualificationBenchmark().then(value=>window.__qualificationBenchmark=value).catch(error=>window.__qualificationBenchmark={error:String(error)})");
        long maximumWorkingSet = 0;
        for (var attempt = 0; attempt < 700; attempt++)
        {
            long workingSet = Process.GetCurrentProcess().WorkingSet64;
            foreach (var child in web.CoreWebView2.Environment.GetProcessInfos())
            {
                try { using var process = Process.GetProcessById(child.ProcessId); workingSet += process.WorkingSet64; }
                catch (ArgumentException) { }
            }
            maximumWorkingSet = Math.Max(maximumWorkingSet, workingSet);
            if (await web.ExecuteScriptAsync("!!window.__qualificationBenchmark") == "true") break;
            await Task.Delay(100);
        }
        var benchmark = await web.ExecuteScriptAsync("window.__qualificationBenchmark ?? null");
        File.WriteAllText(Path.Combine(evidence, "worker-benchmark.json"), benchmark);
        File.WriteAllText(Path.Combine(evidence, "memory.json"), JsonSerializer.Serialize(new { maximumWorkingSet, measurement = "100ms sampled process-tree working set during worker benchmark; not absolute lifetime peak" }));
        if (await web.ExecuteScriptAsync("window.__qualificationBenchmark?.results?.every(row=>row.expectationMet) ?? false") != "true")
            throw new InvalidOperationException("Worker boundary benchmark failed; inspect worker-benchmark.json");
        await web.ExecuteScriptAsync("window.__runQualificationWorkflows().then(value=>window.__qualificationWorkflows=value).catch(error=>window.__qualificationWorkflows={passed:false,error:String(error)})");
        for (var attempt = 0; attempt < 900; attempt++)
        {
            if (await web.ExecuteScriptAsync("!!window.__qualificationWorkflows") == "true") break;
            await Task.Delay(100);
        }
        File.WriteAllText(Path.Combine(evidence, "workflows.json"), await web.ExecuteScriptAsync("window.__qualificationWorkflows ?? null"));
        if (await web.ExecuteScriptAsync("window.__qualificationWorkflows?.passed ?? false") != "true")
            throw new InvalidOperationException("Native fixture workflows failed; inspect workflows.json");
        using (var picture = File.Create(Path.Combine(evidence, "native-editor.png")))
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, picture);
        File.WriteAllText(Path.Combine(evidence, "runtime.json"), await web.ExecuteScriptAsync("({viewport:{width:innerWidth,height:innerHeight},workers:performance.getEntriesByType('resource').filter(x=>x.name.includes('worker')).map(x=>x.name),body:document.body.innerText})"));
        File.WriteAllText(Path.Combine(evidence, "result.json"), JsonSerializer.Serialize(new
        {
            physicalTabReachedEditor = true, physicalTabExitedEditor = true,
            completionOfferedAndAccepted = true,
            scope = "WebView2 production fixture with product CSP; no packaged IPC/disk/Cloud claims"
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
