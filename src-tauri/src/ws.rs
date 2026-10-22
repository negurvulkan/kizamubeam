//! WebSocket zur Steuerung (FluidNC: Port 81, ab und zu auch 80). Als Byte-Strom für den Streamer verpackt:
//! Gesendete Bytes gehen als eine Nachricht hinaus, empfangene Nachrichten werden zu Bytes.
//! FluidNC schickt die Ausgabe der Steuerung als Binärnachrichten und eigene Meldungen
//! (CURRENT_ID, ACTIVE_ID, PING …) als Textnachrichten ohne Zeilenende; diese werden verworfen.

use std::collections::VecDeque;
use std::io::{self, ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;
use tungstenite::client::IntoClientRequest;
use tungstenite::error::{Error as WsError, ProtocolError};
use tungstenite::{Message, WebSocket};

pub struct WsPort<S: Read + Write> {
    ws: WebSocket<S>,
    rx: VecDeque<u8>,
}

/// Textnachrichten von FluidNC selbst, nicht von der Steuerung
fn is_control(text: &str) -> bool {
    ["CURRENT_ID:", "ACTIVE_ID:", "PING:", "DHT:"].iter().any(|p| text.starts_with(p))
}

fn io_err(e: WsError) -> io::Error {
    match e {
        WsError::Io(e) => e,
        WsError::ConnectionClosed | WsError::AlreadyClosed => io::Error::new(ErrorKind::ConnectionAborted, "Die Gegenstelle hat die Verbindung beendet."),
        e => io::Error::other(e.to_string()),
    }
}

impl<S: Read + Write> WsPort<S> {
    pub fn new(ws: WebSocket<S>) -> Self {
        WsPort { ws, rx: VecDeque::new() }
    }

    fn take(&mut self, buf: &mut [u8]) -> usize {
        let n = buf.len().min(self.rx.len());
        for (b, v) in buf.iter_mut().zip(self.rx.drain(..n)) {
            *b = v;
        }
        n
    }
}

impl<S: Read + Write> Read for WsPort<S> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if !self.rx.is_empty() {
            return Ok(self.take(buf));
        }
        loop {
            // Zeitüberschreitung des Sockets kommt als WouldBlock/TimedOut zurück; eine halb gelesene Nachricht bleibt im Puffer
            match self.ws.read().map_err(io_err)? {
                Message::Binary(b) => self.rx.extend(b.iter()),
                Message::Text(t) => {
                    if is_control(t.as_str()) {
                        continue;
                    }
                    self.rx.extend(t.as_bytes());
                    if !t.as_str().ends_with('\n') {
                        self.rx.push_back(b'\n');
                    }
                }
                Message::Close(_) => return Err(io::Error::new(ErrorKind::ConnectionAborted, "Die Gegenstelle hat die Verbindung beendet.")),
                // Ping beantwortet tungstenite selbst
                _ => continue,
            }
            if !self.rx.is_empty() {
                return Ok(self.take(buf));
            }
        }
    }
}

impl<S: Read + Write> Write for WsPort<S> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // Text, solange es gültiges UTF-8 ist (G-Code, ? ! ~ 0x18); sonst binär (z. B. 0x85 Jog abbrechen)
        let msg = match std::str::from_utf8(buf) {
            Ok(s) => Message::text(s),
            Err(_) => Message::binary(buf.to_vec()),
        };
        self.ws.send(msg).map_err(io_err)?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.ws.flush().map_err(io_err)
    }
}

#[allow(clippy::result_large_err)]
fn handshake(addr: SocketAddr, host: &str, port: u16, protocol: Option<&str>) -> Result<WebSocket<TcpStream>, WsError> {
    let s = TcpStream::connect_timeout(&addr, Duration::from_secs(5))?;
    s.set_read_timeout(Some(Duration::from_secs(5)))?;
    s.set_write_timeout(Some(Duration::from_secs(5)))?;
    let _ = s.set_nodelay(true);
    let mut req = format!("ws://{host}:{port}/").into_client_request()?;
    if let Some(p) = protocol {
        req.headers_mut().insert("Sec-WebSocket-Protocol", p.parse().unwrap());
    }
    let (ws, _) = tungstenite::client(req, s).map_err(|e| match e {
        tungstenite::HandshakeError::Failure(e) => e,
        tungstenite::HandshakeError::Interrupted(_) => WsError::Io(io::Error::new(ErrorKind::TimedOut, "Zeitüberschreitung")),
    })?;
    ws.get_ref().set_read_timeout(Some(Duration::from_millis(10)))?;
    Ok(ws)
}

/// Verbinden. Die Web-Oberfläche von FluidNC meldet sich mit dem Unterprotokoll „arduino“ an; antwortet der Server
/// darauf nicht, geht es ohne. Ist Port 81 bzw. 80 nicht erreichbar, wird der andere versucht.
pub fn connect(host: &str, port: u16) -> Result<WsPort<TcpStream>, String> {
    let host = host.trim();
    let mut ports = vec![port];
    match port {
        81 => ports.push(80),
        80 => ports.push(81),
        _ => {}
    }
    let mut first_err: Option<String> = None;
    for p in ports {
        let addr = (host, p)
            .to_socket_addrs()
            .map_err(|e| format!("{host}: {e}"))?
            .next()
            .ok_or_else(|| format!("{host}: Adresse nicht gefunden"))?;
        let r = match handshake(addr, host, p, Some("arduino")) {
            Err(WsError::Protocol(ProtocolError::SecWebSocketSubProtocolError(_))) => handshake(addr, host, p, None),
            r => r,
        };
        match r {
            Ok(ws) => return Ok(WsPort::new(ws)),
            Err(e) => {
                first_err.get_or_insert(format!("ws://{host}:{p}: {e}"));
            }
        }
    }
    Err(first_err.unwrap_or_default())
}

#[cfg(test)]
#[allow(clippy::result_large_err)]
mod tests {
    use super::*;
    use crate::stream::{Cmd, Events, Protocol, Streamer};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    #[derive(Clone, Default)]
    struct Log(Arc<Mutex<Vec<String>>>);
    impl Events for Log {
        fn line(&self, l: &str) {
            self.0.lock().unwrap().push(format!("line {l}"));
        }
        fn progress(&self, _: usize, _: usize, _: usize, _: usize) {}
        fn done(&self, ok: bool, m: &str) {
            self.0.lock().unwrap().push(format!("done {ok} {m}"));
        }
        fn closed(&self, r: Option<String>) {
            self.0.lock().unwrap().push(format!("closed {r:?}"));
        }
    }

    /// Nachgebildetes FluidNC: meldet sich mit CURRENT_ID/ACTIVE_ID, schickt PING, antwortet binär,
    /// verteilt Antworten auch über mehrere Nachrichten.
    fn fake_fluidnc(srv: TcpListener, with_protocol: bool) -> std::thread::JoinHandle<Vec<String>> {
        std::thread::spawn(move || loop {
            let (s, _) = srv.accept().unwrap();
            let cb = move |req: &tungstenite::handshake::server::Request, mut resp: tungstenite::handshake::server::Response| {
                let asked = req.headers().get("Sec-WebSocket-Protocol").map(|v| v.to_str().unwrap().to_string());
                if with_protocol && asked.as_deref() == Some("arduino") {
                    resp.headers_mut().insert("Sec-WebSocket-Protocol", "arduino".parse().unwrap());
                }
                Ok(resp)
            };
            let mut ws = tungstenite::accept_hdr(s, cb).unwrap();
            // Lehnt der Client die Antwort ab (Unterprotokoll fehlt), kommt die nächste Verbindung
            if ws.send(Message::text("CURRENT_ID:0")).is_err() || ws.send(Message::text("ACTIVE_ID:0")).is_err() {
                continue;
            }
            let mut got = Vec::new();
            let mut pending = String::new();
            loop {
                let msg = match ws.read() {
                    Ok(m) => m,
                    Err(_) => break,
                };
                let data = match msg {
                    Message::Text(t) => t.as_str().to_string(),
                    Message::Binary(b) => String::from_utf8_lossy(&b).to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                for c in data.chars() {
                    if c == '?' {
                        let _ = ws.send(Message::binary(b"<Idle|MPos:0.000,0.000,0.000|FS:0,0>\r\n".to_vec()));
                    } else if c == '\n' {
                        let line = std::mem::take(&mut pending);
                        got.push(line.clone());
                        // ok in zwei Teilen, dazwischen ein PING
                        let _ = ws.send(Message::binary(b"o".to_vec()));
                        let _ = ws.send(Message::text("PING:60000:60000"));
                        let _ = ws.send(Message::binary(b"k\r\n".to_vec()));
                        if line == "M2" {
                            for _ in 0..10 {
                                std::thread::sleep(Duration::from_millis(30));
                                let _ = ws.send(Message::binary(b"<Idle|MPos:0.000,0.000,0.000|FS:0,0>\r\n".to_vec()));
                            }
                        }
                    } else {
                        pending.push(c);
                    }
                }
            }
            if !got.is_empty() {
                return got;
            }
        })
    }

    fn run_job(with_protocol: bool) {
        let srv = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = srv.local_addr().unwrap().port();
        let server = fake_fluidnc(srv, with_protocol);
        let ws = connect("127.0.0.1", port).unwrap();
        let log = Log::default();
        let busy = Arc::new(AtomicBool::new(false));
        let (tx, rx) = std::sync::mpsc::channel();
        let lines: Vec<String> = (0..200).map(|i| format!("G1 X{}.5 Y{} S{} F3000", i % 37, i % 11, i % 1000)).chain(["M5".into(), "M2".into()]).collect();
        tx.send(Cmd::Job(lines.clone())).unwrap();
        let proto = Protocol { telnet: false, sync: false, realtime: true, poll: None, rx_buffer: crate::stream::RX_BUFFER };
        let st = Streamer::new(ws, log.clone(), busy.clone(), proto);
        let client = std::thread::spawn(move || st.run(rx));
        let t0 = Instant::now();
        while !log.0.lock().unwrap().iter().any(|x| x.starts_with("done")) {
            assert!(t0.elapsed() < Duration::from_secs(10), "Zeitüberschreitung: {:?}", log.0.lock().unwrap());
            std::thread::sleep(Duration::from_millis(20));
        }
        tx.send(Cmd::Close).unwrap();
        client.join().unwrap();
        assert_eq!(server.join().unwrap(), lines);
        assert!(!busy.load(Ordering::SeqCst));
        let l = log.0.lock().unwrap();
        assert!(l.iter().any(|x| x.starts_with("done true")), "{l:?}");
        assert!(!l.iter().any(|x| x.contains("CURRENT_ID") || x.contains("PING")), "{l:?}");
    }

    #[test]
    fn job_over_websocket_with_subprotocol() {
        run_job(true);
    }

    #[test]
    fn job_over_websocket_without_subprotocol() {
        run_job(false);
    }

    #[test]
    fn unreachable_port_reports_error() {
        let srv = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = srv.local_addr().unwrap().port();
        drop(srv);
        assert!(connect("127.0.0.1", port).is_err());
    }
}
