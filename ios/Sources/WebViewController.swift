import UIKit
import WebKit

/// Hosts the scanner interface (index.html, bundled in the app) full screen and
/// routes messages from it to the Bluetooth bridge.
final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private var ble: BLEBridge!
    private var darkTheme = true

    override var preferredStatusBarStyle: UIStatusBarStyle { darkTheme ? .lightContent : .darkContent }
    override var prefersHomeIndicatorAutoHidden: Bool { false }

    override func loadView() {
        let contentController = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // page handles safe areas itself
        webView.scrollView.isScrollEnabled = false                    // screens scroll internally
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        view = webView

        ble = BLEBridge(webView: webView, presenter: self)
        contentController.add(WeakScriptHandler(self), name: "ble")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            webView.loadHTMLString("<h1 style='color:white;font-family:-apple-system'>index.html missing from the app bundle</h1>", baseURL: nil)
        }
    }

    // Messages from the page: window.webkit.messageHandlers.ble.postMessage({op: ...})
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        switch op {
        case "connect":
            ble.connect()
        case "write":
            if let s = body["data"] as? String { ble.write(s) }
        case "disconnect":
            ble.disconnect()
        case "fetch":
            // JSON lookups for the page (NHTSA VIN decoder, NHTSA photos, Wikimedia Commons) without browser CORS limits.
            guard let id = body["id"] as? String, let str = body["url"] as? String, let url = URL(string: str),
                  url.scheme == "https", let host = url.host,
                  ["vpic.nhtsa.dot.gov", "api.nhtsa.gov", "commons.wikimedia.org"].contains(host) else { return }
            URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                DispatchQueue.main.async { self?.callJS("__nativeFetch", [id, text]) }
            }.resume()
        case "share":
            share(name: body["name"] as? String ?? "scan.csv", text: body["data"] as? String ?? "")
        case "theme":
            darkTheme = (body["value"] as? String) != "light"
            let bg: UIColor = darkTheme ? .black : UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1)
            webView.backgroundColor = bg
            webView.scrollView.backgroundColor = bg
            view.window?.backgroundColor = bg
            setNeedsStatusBarAppearanceUpdate()
        default:
            break
        }
    }

    /// Calls window.<fn>(...args) with the arguments safely JSON-encoded.
    private func callJS(_ fn: String, _ args: [String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: args),
              let wrapped = String(data: data, encoding: .utf8) else { return }
        let list = String(wrapped.dropFirst().dropLast())   // ["a","b"] -> "a","b"
        webView.evaluateJavaScript("if (window.\(fn)) window.\(fn)(\(list));", completionHandler: nil)
    }

    private func share(name: String, text: String) {
        let safeName = name.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { return }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = view
        vc.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(vc, animated: true)
    }

    // Open any real web links (none today) in Safari rather than inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http",
           navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

/// Avoids a retain cycle between WKUserContentController and the view controller.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
