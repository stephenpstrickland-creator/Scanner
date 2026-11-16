import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = .black
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    // Keep the screen on while the scanner is open (handy in the truck).
    func applicationDidBecomeActive(_ application: UIApplication) { application.isIdleTimerDisabled = true }
    func applicationWillResignActive(_ application: UIApplication) { application.isIdleTimerDisabled = false }
}
