// Resonance Control — помощник для кнопок управления плеером в обоях Resonance.
// Слушает только 127.0.0.1:57391 и выполняет команды лишь от процессов
// Wallpaper Engine / Lively: нажимает системные медиаклавиши (Windows передаёт
// их текущему плееру — Яндекс Музыке, Spotify, браузеру) и, если доступен
// системный медиа-API, перематывает трек.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
#if SMTC
using Windows.Foundation;
using Windows.Media.Control;
#endif

static class ResonanceControl
{
    const int Port = 57391;
    static bool anyClient;

    [DllImport("user32.dll")]
    static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int af, int tableClass, uint reserved);

    [StructLayout(LayoutKind.Sequential)]
    struct TcpRow
    {
        public uint state, localAddr, localPort, remoteAddr, remotePort, owningPid;
    }

    static void Key(byte vk)
    {
        keybd_event(vk, 0, 1, UIntPtr.Zero);       // KEYEVENTF_EXTENDEDKEY
        keybd_event(vk, 0, 1 | 2, UIntPtr.Zero);   // + KEYEVENTF_KEYUP
    }

    static int NetPort(uint v) { return (int)(((v & 0xFF) << 8) | ((v >> 8) & 0xFF)); }

    // какой процесс открыл соединение (по таблице TCP Windows)
    static int ClientPid(int clientPort)
    {
        int size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2, 5, 0);   // AF_INET, TCP_TABLE_OWNER_PID_ALL
        IntPtr buf = Marshal.AllocHGlobal(size);
        try
        {
            if (GetExtendedTcpTable(buf, ref size, false, 2, 5, 0) != 0) return -1;
            int n = Marshal.ReadInt32(buf);
            int rowSize = Marshal.SizeOf(typeof(TcpRow));
            for (int i = 0; i < n; i++)
            {
                TcpRow r = (TcpRow)Marshal.PtrToStructure(IntPtr.Add(buf, 4 + i * rowSize), typeof(TcpRow));
                if (NetPort(r.localPort) == clientPort && NetPort(r.remotePort) == Port) return (int)r.owningPid;
            }
        }
        finally { Marshal.FreeHGlobal(buf); }
        return -1;
    }

    static string ClientName(TcpClient c)
    {
        int pid = ClientPid(((IPEndPoint)c.Client.RemoteEndPoint).Port);
        if (pid <= 0) return "?";
        try { return Process.GetProcessById(pid).ProcessName.ToLowerInvariant(); }
        catch { return "?"; }
    }

    static bool Allowed(string name)
    {
        return anyClient || name.StartsWith("webwallpaper") || name.StartsWith("wallpaper") || name.Contains("lively");
    }

    // status.txt рядом с exe: кто и когда обращался последним — для диагностики
    static string lastAllowed = "-", lastDenied = "-";
    static readonly object noteLock = new object();
    static void Note(bool ok, string name, string path)
    {
        string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + name + "  " + path;
        lock (noteLock)
        {
            if (ok) lastAllowed = line; else lastDenied = line;
            try
            {
                File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "status.txt"),
                    "allowed: " + lastAllowed + "\r\ndenied:  " + lastDenied + "\r\n");
            }
            catch { }
        }
    }

#if SMTC
    // ждём асинхронную операцию WinRT без AsTask (ему нужен Windows SDK)
    static T Wait<T>(IAsyncOperation<T> op)
    {
        DateTime until = DateTime.UtcNow.AddSeconds(3);
        while (op.Status == AsyncStatus.Started && DateTime.UtcNow < until) Thread.Sleep(5);
        if (op.Status != AsyncStatus.Completed) throw new TimeoutException();
        return op.GetResults();
    }

    static GlobalSystemMediaTransportControlsSessionManager manager;
    static GlobalSystemMediaTransportControlsSessionManager Manager()
    {
        if (manager == null) manager = Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
        return manager;
    }
    static bool CanSeek()
    {
        try { return Manager() != null; } catch { return false; }
    }
    static string Norm(string s) { return (s ?? "").Trim().ToLowerInvariant(); }

    // плеер, чей трек показан на обоях. «Текущая» сессия Windows — это просто тот,
    // где звук запускали последним (например, YouTube), а нам нужен тот, что на экране
    static GlobalSystemMediaTransportControlsSession Target(string title, string artist)
    {
        GlobalSystemMediaTransportControlsSessionManager m = Manager();
        string t = Norm(title), a = Norm(artist);
        GlobalSystemMediaTransportControlsSession best = null;
        int bestScore = 0;
        if (t.Length > 0 || a.Length > 0)
        {
            foreach (GlobalSystemMediaTransportControlsSession s in m.GetSessions())
            {
                int score = 0;
                try
                {
                    GlobalSystemMediaTransportControlsSessionMediaProperties p = Wait(s.TryGetMediaPropertiesAsync());
                    if (t.Length > 0 && Norm(p.Title) == t) score += 2;
                    if (a.Length > 0 && Norm(p.Artist) == a) score += 1;
                }
                catch { }
                if (score > bestScore) { bestScore = score; best = s; }
            }
        }
        return best ?? m.GetCurrentSession();
    }

    // 1 — выполнено, 0 — плеер найден, но отказал, -1 — системный API недоступен
    static int Command(string cmd, string title, string artist, double seconds)
    {
        GlobalSystemMediaTransportControlsSession s;
        try { s = Target(title, artist); } catch { return -1; }
        if (s == null) return -1;
        try
        {
            bool ok = false;
            if (cmd == "playpause") ok = Wait(s.TryTogglePlayPauseAsync());
            else if (cmd == "next") ok = Wait(s.TrySkipNextAsync());
            else if (cmd == "prev") ok = Wait(s.TrySkipPreviousAsync());
            else if (cmd == "seek") ok = Wait(s.TryChangePlaybackPositionAsync((long)(seconds * 10000000.0)));
            return ok ? 1 : 0;
        }
        catch { return 0; }
    }
#else
    static bool CanSeek() { return false; }
    static int Command(string cmd, string title, string artist, double seconds) { return -1; }
#endif

    static string ReadHead(NetworkStream s)
    {
        byte[] buf = new byte[8192];
        int len = 0;
        while (len < buf.Length)
        {
            int n = s.Read(buf, len, buf.Length - len);
            if (n <= 0) break;
            len += n;
            string text = Encoding.ASCII.GetString(buf, 0, len);
            if (text.Contains("\r\n\r\n")) return text;
        }
        return len > 0 ? Encoding.ASCII.GetString(buf, 0, len) : null;
    }

    static void Send(NetworkStream s, int code, string body)
    {
        string status = code == 200 ? "OK" : code == 204 ? "No Content" : code == 403 ? "Forbidden" : "Not Found";
        byte[] b = Encoding.UTF8.GetBytes(body);
        string head =
            "HTTP/1.1 " + code + " " + status + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: *\r\n" +
            "Access-Control-Allow-Private-Network: true\r\n" +
            "Cache-Control: no-store\r\n" +
            "Content-Length: " + b.Length + "\r\n" +
            "Connection: close\r\n\r\n";
        byte[] h = Encoding.ASCII.GetBytes(head);
        s.Write(h, 0, h.Length);
        if (b.Length > 0) s.Write(b, 0, b.Length);
    }

    static string QueryText(string query, string key)
    {
        foreach (string part in query.Split('&'))
        {
            int eq = part.IndexOf('=');
            if (eq > 0 && part.Substring(0, eq) == key)
            {
                try { return Uri.UnescapeDataString(part.Substring(eq + 1)); } catch { return ""; }
            }
        }
        return "";
    }

    static double QueryNumber(string query, string key)
    {
        double v;
        return double.TryParse(QueryText(query, key), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : -1;
    }

    static void Handle(TcpClient c)
    {
        using (c)
        using (NetworkStream s = c.GetStream())
        {
            s.ReadTimeout = 2000;
            string head = ReadHead(s);
            if (head == null) return;
            string[] first = head.Split('\n')[0].Trim().Split(' ');
            if (first.Length < 2) return;
            if (first[0] == "OPTIONS") { Send(s, 204, ""); return; }
            string target = first[1], path = target, query = "";
            int q = target.IndexOf('?');
            if (q >= 0) { path = target.Substring(0, q); query = target.Substring(q + 1); }
            string client = ClientName(c);
            bool allowed = Allowed(client);
            Note(allowed, client, path);
            if (!allowed) { Send(s, 403, "{\"ok\":false}"); return; }
            const string ok = "{\"ok\":true}", fail = "{\"ok\":false}";
            string title = QueryText(query, "title"), artist = QueryText(query, "artist");
            switch (path)
            {
                case "/ping": Send(s, 200, "{\"ok\":true,\"v\":2,\"seek\":" + (CanSeek() ? "true" : "false") + "}"); return;
                case "/playpause":
                case "/next":
                case "/prev":
                    {
                        int r = Command(path.Substring(1), title, artist, 0);
                        // медиаклавиша — только если системный API недоступен совсем
                        if (r < 0) Key(path == "/playpause" ? (byte)0xB3 : path == "/next" ? (byte)0xB0 : (byte)0xB1);
                        Send(s, 200, r != 0 ? ok : fail);
                        return;
                    }
                case "/seek":
                    {
                        double t = QueryNumber(query, "t");
                        Send(s, 200, t >= 0 && Command("seek", title, artist, t) == 1 ? ok : fail);
                        return;
                    }
                case "/who":   // диагностика: какой плеер получил бы команду (ничего не нажимает)
                    {
                        string app = "";
#if SMTC
                        try
                        {
                            GlobalSystemMediaTransportControlsSession t = Target(title, artist);
                            if (t != null) app = t.SourceAppUserModelId ?? "";
                        }
                        catch { }
#endif
                        Send(s, 200, "{\"ok\":true,\"app\":\"" + app.Replace("\\", "/").Replace("\"", "'") + "\"}");
                        return;
                    }
                default: Send(s, 404, fail); return;
            }
        }
    }

    static void Main(string[] args)
    {
        anyClient = Array.IndexOf(args, "--any") >= 0;
        bool created;
        using (Mutex single = new Mutex(true, "Local\\ResonanceControl" + Port, out created))
        {
            if (!created) return;   // уже запущен
            TcpListener listener = new TcpListener(IPAddress.Loopback, Port);
            try { listener.Start(); } catch { return; }
            while (true)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { Thread.Sleep(250); continue; }
                ThreadPool.QueueUserWorkItem(delegate { try { Handle(client); } catch { } });
            }
        }
    }
}
