using System.Diagnostics;
using System.IO;
using System.Text.Json;
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
        if (args.Length != 5) throw new ArgumentException("URL NEW_EVIDENCE_DIR WIDTH HEIGHT ZOOM required");
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
            };
            web.Source = url;
        };
        new Application().Run(window);
    }
}
