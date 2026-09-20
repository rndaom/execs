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

    private static async Task Key(IntPtr window, byte key, byte modifier = 0)
    {
        if (GetForegroundWindow() != window) throw new InvalidOperationException("Qualification window lost foreground; no input sent");
        if (modifier != 0) keybd_event(modifier, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 2, UIntPtr.Zero);
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
        await Task.Delay(1500);
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
        await Key(handle, 0x23, 0x11);
        await Key(handle, 0x0D);
        foreach (var character in "// paint latency sample abcdefghijklmnopqrstuvwxyz 0123456789")
        {
            var mapped = VkKeyScan(character);
            await Key(handle, (byte)(mapped & 0xff), (mapped & 0x100) != 0 ? (byte)0x10 : (byte)0);
        }
        File.WriteAllText(Path.Combine(evidence, "paint-latency.json"), await web.ExecuteScriptAsync("(()=>{const values=window.__qualificationPaint.toSorted((a,b)=>a-b);return {measurement:'physical keydown to second requestAnimationFrame; includes monitor frame interval',samples:values.length,p95ms:values[Math.max(0,Math.ceil(values.length*.95)-1)],values}})()"));
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
