import Foundation

struct ServerConfig: Codable, Equatable {
    var url: URL
    var secret: String
}

/// Uygulama ve widget'ın paylaştığı ayarlar (App Group).
enum SharedSettings {
    static let groupID = Bundle.main.object(forInfoDictionaryKey: "AppGroupID") as? String ?? ""
    static var defaults: UserDefaults { UserDefaults(suiteName: groupID) ?? .standard }

    static var server: ServerConfig? {
        get { defaults.data(forKey: "server").flatMap { try? JSONDecoder().decode(ServerConfig.self, from: $0) } }
        set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "server") }
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
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Anahtar hatalı. Ayarlar'dan sunucu bağlantısını kontrol et."
        case .server(let m): return m
        case .invalidURL: return "Sunucu adresi geçersiz."
        }
    }
}

struct APIClient {
    let server: ServerConfig

    init(server: ServerConfig) { self.server = server }

    init?() {
        guard let s = SharedSettings.server else { return nil }
        self.server = s
    }

    private struct ErrorBody: Decodable { var error: String }
    struct OK: Decodable {}

    func send<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil, timeout: TimeInterval = 20) async throws -> T {
        var req = URLRequest(url: server.url.appendingPathComponent(path), timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("Bearer \(server.secret)", forHTTPHeaderField: "Authorization")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Sunucu hatası (\(status))"
            throw APIError.server(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func state() async throws -> (AppState, Data) {
        var req = URLRequest(url: server.url.appendingPathComponent("state"), timeoutInterval: 20)
        req.setValue("Bearer \(server.secret)", forHTTPHeaderField: "Authorization")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.unauthorized }
        guard status == 200 else { throw APIError.server("Sunucu hatası (\(status))") }
        return (try JSONDecoder().decode(AppState.self, from: data), data)
    }

    func summary() async throws -> Summary { try await send("GET", "summary") }

    func saveConfig(_ config: AppConfig) async throws -> AppConfig { try await send("PUT", "config", body: config) }

    func registerDevice(token: String, environment: String, name: String) async throws {
        struct Body: Encodable { var token: String; var env: String; var name: String }
        let _: OK = try await send("POST", "devices", body: Body(token: token, env: environment, name: name))
    }

    func runNow() async throws { let _: OK = try await send("POST", "run", timeout: 60) }
    func sendTest() async throws { let _: OK = try await send("POST", "test") }
    func ackMorning() async throws { let _: OK = try await send("POST", "summary/ack") }
}
