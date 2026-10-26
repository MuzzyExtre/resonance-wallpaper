// Яндекс Станция для обоев Resonance: вход в Яндекс по QR-коду, поиск колонки в домашней сети
// и локальное подключение к ней (протокол «Глагол» — им же пользуется интеграция AlexxIT для Home Assistant).
// Токены хранятся только на этом компьютере, зашифрованные Windows (DPAPI), в station.dat рядом с exe.
// В интернет помощник ходит только к Яндексу: вход, список колонок, обложки и поток трека для визуализации.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

static class Station
{
    const string Passport = "https://passport.yandex.ru/pwl-yandex";
    const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ResonanceControl/4";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly byte[] Entropy = Encoding.ASCII.GetBytes("Resonance.Station.v1");
    static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    class AuthException : Exception { public AuthException(string m) : base(m) { } }

    static readonly object sync = new object(), sendLock = new object(), cacheLock = new object();
    static readonly AutoResetEvent wake = new AutoResetEvent(false);
    static Thread worker, loginThread;

    // что видят обои
    static string phase = "unlinked";   // unlinked | login | search | connecting | connected
    static string note = "", account = "";
    static string xToken, musicToken, savedDevice;
    static string devName = "", devId, devPlatform, devHost, devToken;
    static int devPort;
    static ClientWebSocket socket;
    static Dictionary<string, object> player;
    static bool playing;
    static double volume;
    static string alice = "";
    static DateTime stateAt = DateTime.MinValue;
    static int seq;

    // вход по QR
    static CookieContainer loginJar;
    static Dictionary<string, string> loginHeaders;
    static string loginSubmit, loginLink;
    static DateTime loginUntil;

    // последние обложка и трек — обои могут попросить их повторно
    static string coverKey, coverType, audioId;
    static byte[] coverBytes, audioBytes;

    static volatile string trustHost;

    public static void Init()
    {
        Json.MaxJsonLength = int.MaxValue;
        try { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12; } catch { }
        ServicePointManager.ServerCertificateValidationCallback = CheckCert;
        Load();
    }

    // у колонки самоподписанный сертификат: доверяем ему только для её адреса в домашней сети
    static bool CheckCert(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors)
    {
        if (errors == SslPolicyErrors.None) return true;
        string host = trustHost;
        HttpWebRequest r = sender as HttpWebRequest;
        return host != null && r != null && r.RequestUri.Host == host;
    }

    // ---------- JSON ----------
    static Dictionary<string, object> Obj(object o) { return o as Dictionary<string, object>; }
    static object Get(Dictionary<string, object> d, string k)
    {
        object v;
        return d != null && d.TryGetValue(k, out v) ? v : null;
    }
    static Dictionary<string, object> Parse(string s)
    {
        try { return Obj(Json.DeserializeObject(s)); } catch { return null; }
    }
    static string Str(Dictionary<string, object> d, string k)
    {
        object v = Get(d, k);
        return v == null ? "" : Convert.ToString(v, CultureInfo.InvariantCulture);
    }
    static double Num(Dictionary<string, object> d, string k)
    {
        object v = Get(d, k);
        try { return v == null ? 0 : Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return 0; }
    }
    static bool Bool(Dictionary<string, object> d, string k) { object v = Get(d, k); return v is bool && (bool)v; }
    public static string Quote(string s) { return Json.Serialize(s ?? ""); }

    // ---------- HTTP ----------
    static string Http(string method, string url, string body, string type, CookieContainer jar,
                       Dictionary<string, string> headers, out int status)
    {
        HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
        r.Method = method;
        r.UserAgent = UA;
        r.Accept = "application/json, text/html, */*";
        r.Timeout = 12000;
        r.ReadWriteTimeout = 12000;
        r.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
        if (jar != null) r.CookieContainer = jar;
        if (headers != null) foreach (KeyValuePair<string, string> h in headers) r.Headers[h.Key] = h.Value;
        if (body != null)
        {
            byte[] b = Encoding.UTF8.GetBytes(body);
            r.ContentType = type;
            r.ContentLength = b.Length;
            using (Stream s = r.GetRequestStream()) s.Write(b, 0, b.Length);
        }
        HttpWebResponse resp;
        try { resp = (HttpWebResponse)r.GetResponse(); }
        catch (WebException e) { resp = e.Response as HttpWebResponse; if (resp == null) throw; }
        using (resp)
        {
            status = (int)resp.StatusCode;
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) return sr.ReadToEnd();
        }
    }

    static byte[] Download(string url, int max, out string type)
    {
        HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
        r.UserAgent = UA;
        r.Timeout = 15000;
        r.ReadWriteTimeout = 15000;
        using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
        using (Stream s = resp.GetResponseStream())
        using (MemoryStream ms = new MemoryStream())
        {
            type = Regex.Replace(resp.ContentType ?? "", "[^A-Za-z0-9/+.;= -]", "");
            byte[] buf = new byte[65536];
            int n;
            while ((n = s.Read(buf, 0, buf.Length)) > 0)
            {
                ms.Write(buf, 0, n);
                if (ms.Length > max) throw new Exception("слишком большой файл");
            }
            return ms.ToArray();
        }
    }

    // ---------- вход по QR ----------
    // ссылка для QR-кода; пока код жив, повторный вызов отдаёт ту же
    public static string StartLogin()
    {
        lock (sync) { if (loginLink != null && DateTime.UtcNow < loginUntil) return loginLink; }
        CookieContainer jar = new CookieContainer();
        int st;
        string html = Http("GET", Passport, null, null, jar, null, out st);
        Match m = Regex.Match(html, "__CSRF__ = \"([^\"]+)");
        if (!m.Success) throw new Exception("страница входа Яндекса изменилась (" + st + ")");
        Dictionary<string, string> h = new Dictionary<string, string>();
        h["X-CSRF-Token"] = m.Groups[1].Value;
        string submit = Http("POST", Passport + "/api/passport/auth/password/submit",
            "{\"retpath\":\"https://passport.yandex.ru/\"}", "application/json", jar, h, out st);
        string track = Str(Parse(submit), "track_id");
        if (track.Length == 0) throw new Exception("вход недоступен (" + st + ")");
        string code = Http("POST", Passport + "/api/passport/auth/magic/code",
            "location_id=0&magic_track_id=" + Uri.EscapeDataString(track) + "&track_id=",
            "application/x-www-form-urlencoded", jar, h, out st);
        string link = Str(Parse(code), "link");
        if (!link.StartsWith("https://")) throw new Exception("Яндекс не выдал код входа (" + st + ")");
        lock (sync)
        {
            loginJar = jar; loginHeaders = h; loginSubmit = submit; loginLink = link;
            loginUntil = DateTime.UtcNow.AddMinutes(4);
            note = "";
            if (xToken == null) phase = "login";
            if (loginThread == null || !loginThread.IsAlive)
            {
                loginThread = new Thread(PollLogin);
                loginThread.IsBackground = true;
                loginThread.Start();
            }
        }
        return link;
    }

    static void PollLogin()
    {
        while (true)
        {
            Thread.Sleep(2000);
            CookieContainer jar;
            Dictionary<string, string> h;
            string submit;
            lock (sync)
            {
                if (loginLink == null) return;
                if (DateTime.UtcNow > loginUntil)
                {
                    loginLink = null;
                    if (xToken == null) { phase = "unlinked"; note = "expired"; }
                    return;
                }
                jar = loginJar; h = loginHeaders; submit = loginSubmit;
            }
            try
            {
                int st;
                Dictionary<string, object> r = Parse(Http("POST", Passport + "/api/passport/auth/magic/code/status",
                    submit, "application/json", jar, h, out st));
                if (Str(r, "state") != "otp_auth_finished") continue;
                Http("POST", Passport + "/api/passport/sessions/get_session",
                    "track_id=" + Uri.EscapeDataString(Str(r, "trackId")), "application/x-www-form-urlencoded", jar, h, out st);
                Dictionary<string, string> ch = new Dictionary<string, string>();
                ch["Ya-Client-Host"] = "passport.yandex.ru";
                ch["Ya-Client-Cookie"] = jar.GetCookieHeader(new Uri("https://passport.yandex.ru/"));
                string x = Str(Parse(Http("POST", "https://mobileproxy.passport.yandex.net/1/bundle/oauth/token_by_sessionid",
                    "client_id=c0ebe342af7d48fbbbfcf2d2eedb8f9e&client_secret=ad0a908f0aa341a182a37ecd75bc319e",
                    "application/x-www-form-urlencoded", null, ch, out st)), "access_token");
                if (x.Length == 0) throw new Exception("Яндекс не выдал токен (" + st + ")");
                string name = "";
                try
                {
                    Dictionary<string, string> ah = new Dictionary<string, string>();
                    ah["Authorization"] = "OAuth " + x;
                    name = Str(Parse(Http("GET", "https://mobileproxy.passport.yandex.net/1/bundle/account/short_info/?avatar_size=islands-300",
                        null, null, null, ah, out st)), "display_login");
                }
                catch { }
                string music = MusicToken(x);
                lock (sync)
                {
                    xToken = x; musicToken = music; account = name;
                    loginLink = null; note = ""; phase = "search";
                }
                Save();
                wake.Set();
                return;
            }
            catch (Exception e) { lock (sync) note = e.Message; }
        }
    }

    static string MusicToken(string x)
    {
        int st;
        Dictionary<string, object> r = Parse(Http("POST", "https://oauth.mobile.yandex.net/1/token",
            "client_secret=53bc75238f0c4d08a118e51fe9203300&client_id=23cabbbdc6cd418abb4b39c32c41195d&grant_type=x-token&access_token=" + Uri.EscapeDataString(x),
            "application/x-www-form-urlencoded", null, null, out st));
        string m = Str(r, "access_token");
        if (m.Length > 0) return m;
        if (st == 400 || st == 401 || st == 403) throw new AuthException("relogin");
        throw new Exception("Яндекс недоступен (" + st + ")");
    }

    // GET к API колонок и Музыки: при отказе токен Музыки обновляется из основного
    static Dictionary<string, object> Api(string url, Dictionary<string, string> extra)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            string m, x;
            lock (sync) { m = musicToken; x = xToken; }
            if (x == null) throw new AuthException("relogin");
            if (m == null)
            {
                m = MusicToken(x);
                lock (sync) musicToken = m;
                Save();
            }
            Dictionary<string, string> h = extra != null ? new Dictionary<string, string>(extra) : new Dictionary<string, string>();
            h["Authorization"] = "OAuth " + m;
            int st;
            string body = Http("GET", url, null, null, null, h, out st);
            if (st == 200) return Parse(body);
            if (st == 401 || st == 403) { lock (sync) musicToken = null; continue; }
            throw new Exception("Яндекс ответил " + st);
        }
        throw new AuthException("relogin");
    }

    // ---------- хранение ----------
    static string DataPath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "station.dat"); } }

    static void Save()
    {
        Dictionary<string, object> d = new Dictionary<string, object>();
        lock (sync)
        {
            if (xToken == null) return;
            d["x"] = xToken; d["m"] = musicToken; d["account"] = account; d["device"] = savedDevice;
        }
        try
        {
            byte[] plain = Encoding.UTF8.GetBytes(Json.Serialize(d));
            File.WriteAllBytes(DataPath, ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser));
        }
        catch { }
    }

    static void Load()
    {
        try
        {
            if (!File.Exists(DataPath)) return;
            byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(DataPath), Entropy, DataProtectionScope.CurrentUser);
            Dictionary<string, object> d = Parse(Encoding.UTF8.GetString(plain));
            string x = Str(d, "x");
            if (x.Length == 0) return;
            xToken = x;
            musicToken = Str(d, "m").Length > 0 ? Str(d, "m") : null;
            account = Str(d, "account");
            savedDevice = Str(d, "device").Length > 0 ? Str(d, "device") : null;
            phase = "search";
        }
        catch { }
    }

    static void Forget(string why)
    {
        ClientWebSocket ws;
        lock (sync)
        {
            xToken = null; musicToken = null; account = ""; savedDevice = null;
            player = null; playing = false; ws = socket; phase = "unlinked"; note = why;
        }
        try { File.Delete(DataPath); } catch { }
        if (ws != null) try { ws.Abort(); } catch { }
    }

    public static void Logout() { Forget(""); }

    // ---------- подключение к колонке ----------
    public static void Touch()
    {
        lock (sync)
        {
            if (worker != null) return;
            worker = new Thread(Run);
            worker.IsBackground = true;
            worker.Start();
        }
    }

    static void Run()
    {
        int fails = 0;
        while (true)
        {
            bool linked;
            lock (sync) linked = xToken != null;
            if (!linked) { wake.WaitOne(3000); continue; }
            try { Connect(); fails = 0; }
            catch (AuthException) { Forget("relogin"); continue; }
            catch (Exception e)
            {
                Exception inner = e is AggregateException && e.InnerException != null ? e.InnerException : e;
                lock (sync) note = inner.Message;
            }
            lock (sync) if (xToken != null) phase = "search";
            fails++;
            wake.WaitOne(Math.Min(30000, 2000 * fails));
        }
    }

    static void Connect()
    {
        lock (sync) phase = "search";
        IList devs = Get(Api("https://quasar.yandex.net/glagol/device_list", null), "devices") as IList;
        if (devs == null || devs.Count == 0) throw new Exception("к аккаунту не привязано ни одной колонки");
        List<Mdns.Found> found = Mdns.Browse("_yandexio._tcp.local", 2500);
        Dictionary<string, object> dev = null;
        Mdns.Found where = null;
        foreach (object o in devs)
        {
            Dictionary<string, object> d = Obj(o);
            foreach (Mdns.Found f in found)
            {
                if (f.DeviceId != Str(d, "id")) continue;
                if (dev == null || f.DeviceId == savedDevice) { dev = d; where = f; }
            }
        }
        if (dev == null) throw new Exception("колонка не найдена в домашней сети");
        Dictionary<string, object> tk = Api("https://quasar.yandex.net/glagol/token?device_id=" + Uri.EscapeDataString(Str(dev, "id")) +
            "&platform=" + Uri.EscapeDataString(Str(dev, "platform")), null);
        string token = Str(tk, "token");
        if (token.Length == 0) throw new Exception("колонка не выдала токен");
        lock (sync)
        {
            devId = Str(dev, "id"); devPlatform = Str(dev, "platform"); devName = Str(dev, "name");
            devHost = where.Host; devPort = where.Port; devToken = token; phase = "connecting";
        }
        trustHost = where.Host;
        ClientWebSocket ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(25);
        try
        {
            if (!ws.ConnectAsync(new Uri("wss://" + where.Host + ":" + where.Port + "/"), CancellationToken.None).Wait(8000))
                throw new Exception("колонка не отвечает");
            lock (sync) { socket = ws; phase = "connected"; note = ""; savedDevice = devId; }
            Save();
            Dictionary<string, object> hello = new Dictionary<string, object>();
            hello["command"] = "softwareVersion";
            Send(hello);
            byte[] buf = new byte[1 << 16];
            MemoryStream msg = new MemoryStream();
            while (ws.State == WebSocketState.Open)
            {
                Task<WebSocketReceiveResult> t = ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                if (!t.Wait(20000)) break;   // колонка шлёт состояние хотя бы раз в несколько секунд: молчание — обрыв
                WebSocketReceiveResult r = t.Result;
                if (r.MessageType == WebSocketMessageType.Close) break;
                msg.Write(buf, 0, r.Count);
                if (!r.EndOfMessage) continue;
                OnMessage(Encoding.UTF8.GetString(msg.GetBuffer(), 0, (int)msg.Length));
                msg.SetLength(0);
            }
        }
        finally
        {
            lock (sync) { if (socket == ws) socket = null; player = null; playing = false; }
            try { ws.Abort(); } catch { }
            ws.Dispose();
        }
    }

    static void OnMessage(string text)
    {
        Dictionary<string, object> st = Obj(Get(Parse(text), "state"));
        if (st == null) return;
        lock (sync)
        {
            playing = Bool(st, "playing");
            if (Get(st, "volume") != null) volume = Num(st, "volume");
            alice = Str(st, "aliceState");
            player = Obj(Get(st, "playerState"));
            stateAt = DateTime.UtcNow;
            seq++;
        }
    }

    static bool Send(Dictionary<string, object> payload)
    {
        ClientWebSocket ws;
        string token;
        lock (sync) { ws = socket; token = devToken; }
        if (ws == null || ws.State != WebSocketState.Open) return false;
        Dictionary<string, object> m = new Dictionary<string, object>();
        m["conversationToken"] = token;
        m["id"] = Guid.NewGuid().ToString();
        m["payload"] = payload;
        m["sentTime"] = (long)(DateTime.UtcNow - Epoch).TotalMilliseconds;
        byte[] b = Encoding.UTF8.GetBytes(Json.Serialize(m));
        lock (sendLock)
        {
            try { return ws.SendAsync(new ArraySegment<byte>(b), WebSocketMessageType.Text, true, CancellationToken.None).Wait(5000); }
            catch { return false; }
        }
    }

    // команды от обоев: play | pause | playpause | next | prev | seek (v — секунды) | volume (v — 0..1)
    public static bool Command(string c, double v)
    {
        Dictionary<string, object> p = new Dictionary<string, object>();
        bool now;
        lock (sync) now = playing;
        switch (c)
        {
            case "play": p["command"] = "play"; break;
            case "pause": p["command"] = "stop"; break;
            case "playpause": p["command"] = now ? "stop" : "play"; break;
            case "next": p["command"] = "next"; break;
            case "prev": p["command"] = "prev"; break;
            case "seek":
                if (v < 0) return false;
                p["command"] = "rewind"; p["position"] = v;
                break;
            case "volume":
                if (v < 0 || v > 1) return false;
                p["command"] = "setVolume"; p["volume"] = Math.Round(v, 2);
                break;
            default: return false;
        }
        return Send(p);
    }

    public static string StatusJson()
    {
        Touch();
        Dictionary<string, object> o = new Dictionary<string, object>();
        lock (sync)
        {
            o["ok"] = true;
            o["phase"] = phase;
            o["note"] = note;
            o["account"] = account;
            o["name"] = devName;
            if (loginLink != null && DateTime.UtcNow < loginUntil)
            {
                o["link"] = loginLink;
                o["left"] = (int)(loginUntil - DateTime.UtcNow).TotalSeconds;
            }
            if (phase == "connected" && player != null)
            {
                double prog = Num(player, "progress");
                if (playing) prog += (DateTime.UtcNow - stateAt).TotalSeconds;
                o["playing"] = playing;
                o["title"] = Str(player, "title");
                o["artist"] = Str(player, "subtitle");
                o["duration"] = Num(player, "duration");
                o["progress"] = Math.Round(prog, 3);
                o["id"] = Str(player, "id");
                o["type"] = Str(player, "type");
                o["cover"] = Str(Obj(Get(player, "extra")), "coverURI");
                o["next"] = Bool(player, "hasNext");
                o["prev"] = Bool(player, "hasPrev");
            }
            o["volume"] = volume;
            o["alice"] = alice;
            o["seq"] = seq;
            Report(phase + "  " + devName + "  " + (o.ContainsKey("title") ? o["title"] + (playing ? " ▶" : " ⏸") : "-") + (note.Length > 0 ? "  [" + note + "]" : ""));
        }
        return Json.Serialize(o);
    }

    // station.txt рядом с exe: как идёт подключение (без токенов) — для диагностики
    static string lastReport;
    static readonly object reportLock = new object();
    static void Report(string line)
    {
        lock (reportLock)
        {
            if (line == lastReport) return;
            lastReport = line;
            try
            {
                string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "station.txt");
                if (File.Exists(path) && new FileInfo(path).Length > 200000) File.Delete(path);   // журнал не разрастается
                File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + line + "\r\n");
            }
            catch { }
        }
    }

    // открыть страницу входа в браузере компьютера — только текущую ссылку Яндекса
    public static bool OpenLogin()
    {
        string link;
        lock (sync) link = loginLink;
        if (link == null || !Regex.IsMatch(link, "^https://[a-z0-9.-]*yandex\\.(ru|com)/")) return false;
        try { Process.Start(link); return true; } catch { return false; }
    }

    // обложка в большом размере; только с серверов картинок Яндекса
    public static byte[] Cover(string uri, out string type)
    {
        type = null;
        uri = uri ?? "";
        if (!Regex.IsMatch(uri, "^(https://)?avatars\\.(mds\\.)?yandex\\.net/[^\\s]+$")) return null;
        string url = (uri.StartsWith("https://") ? uri : "https://" + uri).Replace("%%", "1000x1000");
        lock (cacheLock) if (url == coverKey) { type = coverType; return coverBytes; }
        byte[] b = Download(url, 8 << 20, out type);
        lock (cacheLock) { coverKey = url; coverBytes = b; coverType = type; }
        return b;
    }

    // тот же трек, что играет на колонке, — обои разбирают его беззвучно для визуализации
    public static byte[] Audio(string id, out string type)
    {
        type = "audio/mpeg";
        id = id ?? "";
        if (!Regex.IsMatch(id, "^[0-9]+(:[0-9]+)?$")) return null;
        lock (cacheLock) if (id == audioId) return audioBytes;
        string ts = ((long)(DateTime.UtcNow - Epoch).TotalSeconds).ToString(CultureInfo.InvariantCulture);
        const string quality = "lq", codecs = "mp3", transports = "raw";
        string sign;
        using (HMACSHA256 hm = new HMACSHA256(Encoding.ASCII.GetBytes("p93jhgh689SBReK6ghtw62")))
            sign = Convert.ToBase64String(hm.ComputeHash(Encoding.UTF8.GetBytes(ts + id + quality + codecs.Replace(",", "") + transports)));
        sign = sign.Substring(0, sign.Length - 1);
        Dictionary<string, string> h = new Dictionary<string, string>();
        h["X-Yandex-Music-Client"] = "YandexMusicAndroid/24023621";
        Dictionary<string, object> r;
        try
        {
            r = Api("https://api.music.yandex.net/get-file-info?ts=" + ts + "&trackId=" + Uri.EscapeDataString(id) +
                "&quality=" + quality + "&codecs=" + codecs + "&transports=" + transports + "&sign=" + Uri.EscapeDataString(sign), h);
        }
        catch (Exception e) { Report("audio " + id + ": " + e.Message); throw; }
        Dictionary<string, object> info = Obj(Get(Obj(Get(r, "result")), "downloadInfo"));
        string file = Str(info, "url");
        if (!file.StartsWith("https://")) { Report("audio " + id + ": нет ссылки"); return null; }
        string got;
        byte[] b = Download(file, 40 << 20, out got);
        lock (cacheLock) { audioId = id; audioBytes = b; }
        Report("audio " + id + ": " + (b.Length / 1024) + " КБ, " + Str(info, "codec") + " " + Str(info, "bitrate"));
        return b;
    }
}

// поиск колонок в домашней сети по mDNS (служба _yandexio._tcp)
static class Mdns
{
    public class Found { public string DeviceId, Platform, Host, From; public int Port; }

    public static List<Found> Browse(string service, int ms)
    {
        Dictionary<string, Found> inst = new Dictionary<string, Found>();
        Dictionary<string, string> targets = new Dictionary<string, string>(), ips = new Dictionary<string, string>();
        List<Socket> socks = Open();
        try
        {
            if (socks.Count == 0) return new List<Found>();
            SendAll(socks, Query(service, 12));
            Collect(socks, ms, service, inst, targets, ips);
            // ответили без подробностей — доспрашиваем экземпляры и адреса
            bool asked = false;
            foreach (KeyValuePair<string, Found> kv in inst)
            {
                string host;
                if (kv.Value.DeviceId == null || kv.Value.Port == 0) { SendAll(socks, Query(kv.Key, 255)); asked = true; }
                else if (targets.TryGetValue(kv.Key, out host) && !ips.ContainsKey(host)) { SendAll(socks, Query(host, 1)); asked = true; }
            }
            if (asked) Collect(socks, 1200, service, inst, targets, ips);
        }
        finally { foreach (Socket s in socks) s.Close(); }
        List<Found> res = new List<Found>();
        foreach (KeyValuePair<string, Found> kv in inst)
        {
            Found f = kv.Value;
            if (f.DeviceId == null || f.Port == 0) continue;
            string host;
            if (targets.TryGetValue(kv.Key, out host) && ips.ContainsKey(host)) f.Host = ips[host];
            if (f.Host == null) f.Host = f.From;
            if (f.Host != null) res.Add(f);
        }
        return res;
    }

    static List<Socket> Open()
    {
        List<Socket> list = new List<Socket>();
        List<IPAddress> local = new List<IPAddress>();
        foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || !ni.SupportsMulticast) continue;
            foreach (UnicastIPAddressInformation a in ni.GetIPProperties().UnicastAddresses)
            {
                if (a.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                byte[] ab = a.Address.GetAddressBytes();
                if (ab[0] == 169 && ab[1] == 254) continue;
                local.Add(a.Address);
                try
                {
                    Socket s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
                    s.Bind(new IPEndPoint(a.Address, 0));
                    s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 255);
                    s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, BitConverter.ToInt32(ab, 0));
                    list.Add(s);
                }
                catch { }
            }
        }
        // ответы, которые колонка всё же разошлёт всем по группе 224.0.0.251:5353
        try
        {
            Socket m = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            m.ExclusiveAddressUse = false;
            m.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            m.Bind(new IPEndPoint(IPAddress.Any, 5353));
            foreach (IPAddress a in local)
                try { m.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.AddMembership, new MulticastOption(IPAddress.Parse("224.0.0.251"), a)); } catch { }
            list.Add(m);
        }
        catch { }
        return list;
    }

    static void SendAll(List<Socket> socks, byte[] q)
    {
        IPEndPoint group = new IPEndPoint(IPAddress.Parse("224.0.0.251"), 5353);
        foreach (Socket s in socks)
        {
            if (((IPEndPoint)s.LocalEndPoint).Port == 5353) continue;
            try { s.SendTo(q, group); } catch { }
        }
    }

    static byte[] Query(string name, int type)
    {
        MemoryStream ms = new MemoryStream();
        ms.Write(new byte[] { 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 }, 0, 12);
        foreach (string label in name.Split('.'))
        {
            byte[] b = Encoding.UTF8.GetBytes(label);
            ms.WriteByte((byte)b.Length);
            ms.Write(b, 0, b.Length);
        }
        ms.WriteByte(0);
        ms.WriteByte((byte)(type >> 8)); ms.WriteByte((byte)type);
        ms.WriteByte(0x80); ms.WriteByte(1);   // класс IN, «ответьте мне напрямую»
        return ms.ToArray();
    }

    static void Collect(List<Socket> socks, int ms, string service, Dictionary<string, Found> inst,
                        Dictionary<string, string> targets, Dictionary<string, string> ips)
    {
        DateTime until = DateTime.UtcNow.AddMilliseconds(ms);
        byte[] buf = new byte[9000];
        while (DateTime.UtcNow < until)
        {
            List<Socket> ready = new List<Socket>(socks);
            Socket.Select(ready, null, null, 100000);
            foreach (Socket s in ready)
            {
                EndPoint ep = new IPEndPoint(IPAddress.Any, 0);
                int n;
                try { n = s.ReceiveFrom(buf, ref ep); } catch { continue; }
                try { Parse(buf, n, ((IPEndPoint)ep).Address.ToString(), "." + service.ToLowerInvariant(), inst, targets, ips); } catch { }
            }
        }
    }

    static Found Item(Dictionary<string, Found> d, string k)
    {
        Found f;
        if (!d.TryGetValue(k, out f)) { f = new Found(); d[k] = f; }
        return f;
    }

    static void Parse(byte[] b, int n, string from, string suffix, Dictionary<string, Found> inst,
                      Dictionary<string, string> targets, Dictionary<string, string> ips)
    {
        if (n < 12) return;
        int qd = (b[4] << 8) | b[5];
        int total = ((b[6] << 8) | b[7]) + ((b[8] << 8) | b[9]) + ((b[10] << 8) | b[11]);
        int pos = 12;
        for (int i = 0; i < qd; i++) { Name(b, n, ref pos); pos += 4; }
        for (int i = 0; i < total && pos < n; i++)
        {
            string key = Name(b, n, ref pos).ToLowerInvariant();
            if (pos + 10 > n) return;
            int type = (b[pos] << 8) | b[pos + 1];
            int len = (b[pos + 8] << 8) | b[pos + 9];
            pos += 10;
            int end = pos + len;
            if (end > n) return;
            int p = pos;
            if (type == 12 && ("." + key) == suffix) Item(inst, Name(b, n, ref p).ToLowerInvariant());
            else if (type == 33 && key.EndsWith(suffix) && len >= 7)
            {
                Found f = Item(inst, key);
                f.Port = (b[pos + 4] << 8) | b[pos + 5];
                f.From = from;
                p = pos + 6;
                targets[key] = Name(b, n, ref p).ToLowerInvariant();
            }
            else if (type == 16 && key.EndsWith(suffix))
            {
                Found f = Item(inst, key);
                f.From = from;
                while (p < end)
                {
                    int l = b[p++];
                    if (p + l > end) break;
                    string kv = Encoding.UTF8.GetString(b, p, l);
                    p += l;
                    int eq = kv.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = kv.Substring(0, eq), v = kv.Substring(eq + 1);
                    if (k == "deviceId") f.DeviceId = v;
                    else if (k == "platform") f.Platform = v;
                }
            }
            else if (type == 1 && len == 4) ips[key] = b[pos] + "." + b[pos + 1] + "." + b[pos + 2] + "." + b[pos + 3];
            pos = end;
        }
    }

    // имя из DNS-пакета (со сжатием ссылками)
    static string Name(byte[] b, int n, ref int pos)
    {
        StringBuilder sb = new StringBuilder();
        int p = pos, guard = 0;
        bool jumped = false;
        while (p < n && guard++ < 128)
        {
            int len = b[p];
            if (len == 0) { p++; break; }
            if ((len & 0xC0) == 0xC0)
            {
                if (p + 1 >= n) { p = n; break; }
                if (!jumped) pos = p + 2;
                jumped = true;
                p = ((len & 0x3F) << 8) | b[p + 1];
                continue;
            }
            p++;
            if (p + len > n) { p = n; break; }
            if (sb.Length > 0) sb.Append('.');
            sb.Append(Encoding.UTF8.GetString(b, p, len));
            p += len;
        }
        if (!jumped) pos = p;
        return sb.ToString();
    }
}
