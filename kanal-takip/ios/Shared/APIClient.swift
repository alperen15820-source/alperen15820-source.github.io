import Foundation

/// Uygulama ve widget'ın paylaştığı ayarlar (App Group).
enum SharedSettings {
    static let groupID = Bundle.main.object(forInfoDictionaryKey: "AppGroupID") as? String ?? ""
    static var defaults: UserDefaults { UserDefaults(suiteName: groupID) ?? .standard }

    /// Sunucu adresi derleme ayarından (API_BASE_URL) gelir.
    static var baseURL: URL? {
        (Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String).flatMap(URL.init(string:))
    }

    /// Anonim hesabın erişim anahtarı (ilk açılışta sunucu verir).
    static var token: String? {
        get { defaults.string(forKey: "token") }
        set { defaults.set(newValue, forKey: "token") }
    }

    static var cachedSummary: Summary? {
        get { defaults.data(forKey: "summary").flatMap { try? JSONDecoder().decode(Summary.self, from: $0) } }
        set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "summary") }
    }

    static var cacheDirectory: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }
}

enum APIError: LocalizedError {
    case unauthorized
    case server(String)
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .unauthorized: return L("Oturum süresi doldu. Uygulamayı yeniden aç.", "Session expired. Please reopen the app.")
        case .server(let m): return m
        case .notConfigured: return L("Sunucu adresi ayarlanmamış.", "Server address is not configured.")
        }
    }
}

struct APIClient {
    let baseURL: URL
    let token: String?

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        self.token = token
    }

    /// Hesabı olan istemci; hesap yoksa nil.
    init?() {
        guard let url = SharedSettings.baseURL, let token = SharedSettings.token else { return nil }
        self.init(baseURL: url, token: token)
    }

    private struct ErrorBody: Decodable { var error: String }
    struct OK: Decodable {}

    private func request(_ method: String, _ path: String, body: (any Encodable)?, timeout: TimeInterval) throws -> URLRequest {
        var req = URLRequest(url: baseURL.appendingPathComponent(path), timeoutInterval: timeout)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue(Lang.code, forHTTPHeaderField: "Accept-Language")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return req
    }

    func raw(_ method: String, _ path: String, body: (any Encodable)? = nil, timeout: TimeInterval = 20) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request(method, path, body: body, timeout: timeout))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? L("Sunucu hatası (\(status))", "Server error (\(status))")
            throw APIError.server(message)
        }
        return data
    }

    func send<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil, timeout: TimeInterval = 20) async throws -> T {
        let data = try await raw(method, path, body: body, timeout: timeout)
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: Uç noktalar

    static func register(baseURL: URL) async throws -> String {
        struct Body: Encodable { var locale: String; var timezone: String }
        struct Res: Decodable { var token: String }
        let res: Res = try await APIClient(baseURL: baseURL, token: nil)
            .send("POST", "v1/register", body: Body(locale: Lang.code, timezone: TimeZone.current.identifier))
        return res.token
    }

    func state() async throws -> (AppState, Data) {
        let data = try await raw("GET", "v1/state")
        return (try JSONDecoder().decode(AppState.self, from: data), data)
    }

    func summary() async throws -> Summary { try await send("GET", "v1/summary") }

    func saveConfig(_ config: AppConfig) async throws -> AppConfig { try await send("PUT", "v1/config", body: config) }

    func syncLocale() async throws {
        struct Body: Encodable { var locale: String; var timezone: String }
        let _: AppConfig = try await send("PUT", "v1/config", body: Body(locale: Lang.code, timezone: TimeZone.current.identifier))
    }

    func registerDevice(token: String, environment: String) async throws {
        struct Body: Encodable { var token: String; var env: String }
        let _: OK = try await send("POST", "v1/devices", body: Body(token: token, env: environment))
    }

    func refreshNow() async throws { let _: OK = try await send("POST", "v1/refresh", timeout: 60) }
    func sendTest() async throws { let _: OK = try await send("POST", "v1/test") }
    func ackMorning() async throws { let _: OK = try await send("POST", "v1/summary/ack") }
    func deleteAccount() async throws { let _: OK = try await send("DELETE", "v1/me") }
}
