//! G-Code-Übertragung an GRBL/FluidNC mit Zeichenzählung: Es werden so viele Zeilen gesendet,
//! wie in den Empfangspuffer der Steuerung passen; jedes `ok`/`error` gibt Platz frei.
//! Unabhängig von Tauri, damit es sich mit einer nachgebildeten Verbindung testen lässt.

use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Empfangspuffer der Steuerung in Bytes (GRBL: 128, FluidNC hat mehr; 127 ist auf jeden Fall sicher).
pub const RX_BUFFER: usize = 127;
const POLL: Duration = Duration::from_millis(200);
const PROGRESS: Duration = Duration::from_millis(200);

pub enum Cmd {
    /// Einzelne Zeile (Konsole, Bewegen, Home …)
    Line(String),
    /// Echtzeitbefehl, wird sofort und ohne Puffer gesendet (? ! ~ 0x18 0x85)
    Realtime(u8),
    Job(Vec<String>),
    Stop,
    Close,
}

pub trait Events: Send {
    fn line(&self, line: &str);
    fn progress(&self, sent: usize, acked: usize, total: usize, errors: usize);
    fn done(&self, ok: bool, message: &str);
    fn closed(&self, reason: Option<String>);
}

struct Job {
    lines: Vec<String>,
    next: usize,
    acked: usize,
    errors: usize,
    /// Alle Zeilen bestätigt, warten auf Stillstand (Idle)
    finishing: bool,
    started: Instant,
}

pub struct Streamer<P: Read + Write, E: Events> {
    port: P,
    events: E,
    busy: Arc<AtomicBool>,
    rx: Vec<u8>,
    /// Gesendete, noch unbestätigte Zeilen: (Länge inkl. Zeilenende, gehört zum Job)
    inflight: VecDeque<(usize, bool)>,
    inflight_bytes: usize,
    queue: VecDeque<String>,
    job: Option<Job>,
    last_poll: Instant,
    last_progress: Instant,
    progress_dirty: bool,
    /// Telnet: IAC-Steuersequenzen ausfiltern
    telnet: bool,
    iac: u8,
}

fn is_comment(l: &str) -> bool {
    let t = l.trim();
    t.is_empty() || t.starts_with(';') || (t.starts_with('(') && t.ends_with(')'))
}

impl<P: Read + Write, E: Events> Streamer<P, E> {
    pub fn new(port: P, events: E, busy: Arc<AtomicBool>, telnet: bool) -> Self {
        let now = Instant::now();
        Streamer {
            port,
            events,
            busy,
            rx: Vec::new(),
            inflight: VecDeque::new(),
            inflight_bytes: 0,
            queue: VecDeque::new(),
            job: None,
            last_poll: now - POLL,
            last_progress: now,
            progress_dirty: false,
            telnet,
            iac: 0,
        }
    }

    /// Hauptschleife: läuft, bis Close kommt oder die Verbindung abreißt.
    pub fn run(mut self, cmds: Receiver<Cmd>) {
        let reason = loop {
            match self.commands(&cmds) {
                Ok(true) => break None,
                Ok(false) => {}
                Err(e) => break Some(e),
            }
            if let Err(e) = self.pump() {
                break Some(e);
            }
        };
        if self.job.take().is_some() {
            self.events.done(false, "Verbindung getrennt");
        }
        self.busy.store(false, Ordering::SeqCst);
        self.events.closed(reason);
    }

    /// Befehle der Oberfläche abarbeiten. true = Verbindung schließen.
    fn commands(&mut self, cmds: &Receiver<Cmd>) -> Result<bool, String> {
        loop {
            match cmds.try_recv() {
                Ok(Cmd::Close) | Err(TryRecvError::Disconnected) => return Ok(true),
                Ok(c) => self.handle(c)?,
                Err(TryRecvError::Empty) => return Ok(false),
            }
        }
    }

    pub fn handle(&mut self, c: Cmd) -> Result<(), String> {
        match c {
            Cmd::Line(l) => {
                if self.job.is_none() {
                    self.queue.push_back(l)
                }
            }
            Cmd::Realtime(b) => self.write(&[b])?,
            Cmd::Job(lines) => {
                if self.job.is_none() {
                    let total = lines.len();
                    self.job = Some(Job { lines, next: 0, acked: 0, errors: 0, finishing: false, started: Instant::now() });
                    self.busy.store(true, Ordering::SeqCst);
                    self.events.progress(0, 0, total, 0);
                }
            }
            Cmd::Stop => {
                // Erst anhalten, dann zurücksetzen: so bleibt die Position erhalten und es gibt keinen Alarm.
                self.write(b"!")?;
                std::thread::sleep(Duration::from_millis(300));
                self.write(&[0x18])?;
                self.queue.clear();
                self.inflight.clear();
                self.inflight_bytes = 0;
                if self.job.take().is_some() {
                    self.busy.store(false, Ordering::SeqCst);
                    self.events.done(false, "Abgebrochen");
                }
            }
            Cmd::Close => {}
        }
        Ok(())
    }

    fn write(&mut self, b: &[u8]) -> Result<(), String> {
        self.port.write_all(b).map_err(|e| format!("Senden fehlgeschlagen: {e}"))?;
        self.port.flush().map_err(|e| format!("Senden fehlgeschlagen: {e}"))
    }

    /// Einmal lesen, Puffer füllen, Status abfragen.
    pub fn pump(&mut self) -> Result<(), String> {
        let mut buf = [0u8; 2048];
        match self.port.read(&mut buf) {
            Ok(0) => {
                if self.telnet {
                    return Err("Die Gegenstelle hat die Verbindung beendet.".into());
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Ok(n) => self.on_bytes(&buf[..n]),
            Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
            Err(e) => return Err(format!("Lesen fehlgeschlagen: {e}")),
        }
        self.fill()?;
        if self.last_poll.elapsed() >= POLL {
            self.last_poll = Instant::now();
            self.write(b"?")?;
        }
        if self.progress_dirty && self.last_progress.elapsed() >= PROGRESS {
            self.send_progress();
        }
        Ok(())
    }

    fn send_progress(&mut self) {
        self.progress_dirty = false;
        self.last_progress = Instant::now();
        if let Some(j) = &self.job {
            self.events.progress(j.next, j.acked, j.lines.len(), j.errors);
        }
    }

    pub fn on_bytes(&mut self, data: &[u8]) {
        for &b in data {
            if self.telnet {
                // IAC (255) + Befehl + Option überspringen
                if self.iac > 0 {
                    self.iac -= 1;
                    continue;
                }
                if b == 255 {
                    self.iac = 2;
                    continue;
                }
            }
            if b == b'\n' {
                let raw = std::mem::take(&mut self.rx);
                let line = String::from_utf8_lossy(&raw).trim().to_string();
                if !line.is_empty() {
                    self.on_line(&line);
                }
            } else if b != b'\r' {
                self.rx.push(b);
            }
        }
    }

    fn pop_inflight(&mut self) -> bool {
        match self.inflight.pop_front() {
            Some((len, job)) => {
                self.inflight_bytes -= len;
                job
            }
            None => false,
        }
    }

    fn on_line(&mut self, line: &str) {
        let lower = line.to_ascii_lowercase();
        if lower == "ok" {
            if self.pop_inflight() {
                if let Some(j) = &mut self.job {
                    j.acked += 1;
                    self.progress_dirty = true;
                }
            } else {
                self.events.line(line);
            }
            return;
        }
        if lower.starts_with("error") {
            if self.pop_inflight() {
                if let Some(j) = &mut self.job {
                    j.acked += 1;
                    j.errors += 1;
                    self.progress_dirty = true;
                }
            }
            self.events.line(line);
            return;
        }
        if line.starts_with('<') {
            self.events.line(line);
            let idle = line.starts_with("<Idle");
            if idle && self.job.as_ref().is_some_and(|j| j.finishing) {
                let j = self.job.take().unwrap();
                self.busy.store(false, Ordering::SeqCst);
                self.events.progress(j.next, j.acked, j.lines.len(), j.errors);
                let secs = j.started.elapsed().as_secs();
                let msg = if j.errors > 0 {
                    format!("Fertig nach {}:{:02} min, {} Fehler", secs / 60, secs % 60, j.errors)
                } else {
                    format!("Fertig nach {}:{:02} min", secs / 60, secs % 60)
                };
                self.events.done(j.errors == 0, &msg);
            }
            return;
        }
        self.events.line(line);
        let reset = line.starts_with("Grbl ");
        if lower.starts_with("alarm") || reset {
            // Alarm oder Neustart der Steuerung: Puffer ist verworfen, Job abbrechen
            self.inflight.clear();
            self.inflight_bytes = 0;
            self.queue.clear();
            if self.job.take().is_some() {
                self.busy.store(false, Ordering::SeqCst);
                self.events.done(false, if reset { "Die Steuerung wurde neu gestartet" } else { "Alarm, Job abgebrochen" });
            }
        }
    }

    fn fits(&self, len: usize) -> bool {
        self.inflight.is_empty() || self.inflight_bytes + len <= RX_BUFFER
    }

    fn send_line(&mut self, l: &str, job: bool) -> Result<(), String> {
        let mut data = l.trim().as_bytes().to_vec();
        data.push(b'\n');
        let len = data.len();
        self.write(&data)?;
        self.inflight.push_back((len, job));
        self.inflight_bytes += len;
        Ok(())
    }

    fn fill(&mut self) -> Result<(), String> {
        if self.job.is_none() {
            while let Some(l) = self.queue.front() {
                if !self.fits(l.trim().len() + 1) {
                    break;
                }
                let l = self.queue.pop_front().unwrap();
                self.send_line(&l, false)?;
            }
            return Ok(());
        }
        loop {
            let Some(j) = &mut self.job else { break };
            if j.next >= j.lines.len() {
                if !j.finishing && !self.inflight.iter().any(|x| x.1) {
                    j.finishing = true;
                    self.progress_dirty = true;
                }
                break;
            }
            let line = &j.lines[j.next];
            if is_comment(line) {
                j.next += 1;
                j.acked += 1;
                continue;
            }
            let len = line.trim().len() + 1;
            if !(self.inflight.is_empty() || self.inflight_bytes + len <= RX_BUFFER) {
                break;
            }
            let line = line.clone();
            j.next += 1;
            self.progress_dirty = true;
            self.send_line(&line, true)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Nachgebildete Steuerung: bestätigt jede Zeile, solange `auto_ok` gesetzt ist.
    #[derive(Clone, Default)]
    struct Fake {
        written: Arc<Mutex<Vec<u8>>>,
        reply: Arc<Mutex<VecDeque<u8>>>,
    }
    impl Read for Fake {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let mut r = self.reply.lock().unwrap();
            if r.is_empty() {
                return Err(std::io::Error::new(ErrorKind::TimedOut, "leer"));
            }
            let n = buf.len().min(r.len());
            for b in buf.iter_mut().take(n) {
                *b = r.pop_front().unwrap();
            }
            Ok(n)
        }
    }
    impl Write for Fake {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.written.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    #[derive(Clone, Default)]
    struct Log(Arc<Mutex<Vec<String>>>);
    impl Events for Log {
        fn line(&self, l: &str) {
            self.0.lock().unwrap().push(format!("line {l}"));
        }
        fn progress(&self, s: usize, a: usize, t: usize, e: usize) {
            self.0.lock().unwrap().push(format!("progress {s} {a} {t} {e}"));
        }
        fn done(&self, ok: bool, m: &str) {
            self.0.lock().unwrap().push(format!("done {ok} {m}"));
        }
        fn closed(&self, r: Option<String>) {
            self.0.lock().unwrap().push(format!("closed {r:?}"));
        }
    }

    fn sent_lines(f: &Fake) -> Vec<String> {
        let w = f.written.lock().unwrap();
        String::from_utf8_lossy(&w).replace('?', "").lines().map(|s| s.to_string()).collect()
    }

    #[test]
    fn respects_buffer_and_finishes_on_idle() {
        let fake = Fake::default();
        let log = Log::default();
        let mut s = Streamer::new(fake.clone(), log.clone(), Arc::new(AtomicBool::new(false)), false);
        let lines: Vec<String> = (0..40).map(|i| format!("G1 X{i}.123 Y{i}.456 S500 F3000")).collect();
        let len = lines[0].len() + 1;
        s.handle(Cmd::Job(lines.clone())).unwrap();
        s.handle(Cmd::Job(vec!["; zweiter Job wird ignoriert".into()])).unwrap();
        s.pump().unwrap();
        // Nur so viele Zeilen, wie in 127 Bytes passen
        let first = sent_lines(&fake).len();
        assert_eq!(first, RX_BUFFER / len);
        assert!(s.inflight_bytes <= RX_BUFFER);
        // Bestätigungen nacheinander
        for _ in 0..40 {
            fake.reply.lock().unwrap().extend(b"ok\r\n");
            s.pump().unwrap();
            assert!(s.inflight_bytes <= RX_BUFFER);
        }
        assert_eq!(sent_lines(&fake), lines);
        assert!(s.job.as_ref().unwrap().finishing);
        fake.reply.lock().unwrap().extend(b"<Run|MPos:1,2,0|FS:0,0>\n");
        s.pump().unwrap();
        assert!(s.job.is_some());
        fake.reply.lock().unwrap().extend(b"<Idle|MPos:1,2,0|FS:0,0>\n");
        s.pump().unwrap();
        assert!(s.job.is_none());
        let l = log.0.lock().unwrap();
        assert!(l.iter().any(|x| x.starts_with("done true")), "{l:?}");
        assert!(!l.iter().any(|x| x == "line ok"), "Job-ok nicht melden");
    }

    #[test]
    fn alarm_aborts_job_and_comments_are_skipped() {
        let fake = Fake::default();
        let log = Log::default();
        let busy = Arc::new(AtomicBool::new(false));
        let mut s = Streamer::new(fake.clone(), log.clone(), busy.clone(), false);
        s.handle(Cmd::Job(vec!["; Kopf".into(), "G21".into(), "".into(), "G0 X1".into()])).unwrap();
        assert!(busy.load(Ordering::SeqCst));
        s.pump().unwrap();
        assert_eq!(sent_lines(&fake), vec!["G21", "G0 X1"]);
        fake.reply.lock().unwrap().extend(b"ok\nALARM:1\n");
        s.pump().unwrap();
        assert!(s.job.is_none());
        assert!(!busy.load(Ordering::SeqCst));
        assert_eq!(s.inflight_bytes, 0);
        assert!(log.0.lock().unwrap().iter().any(|x| x.starts_with("done false")));
    }

    #[test]
    fn console_lines_and_telnet_filter() {
        let fake = Fake::default();
        let log = Log::default();
        let mut s = Streamer::new(fake.clone(), log.clone(), Arc::new(AtomicBool::new(false)), true);
        s.handle(Cmd::Line("$I".into())).unwrap();
        s.pump().unwrap();
        assert_eq!(sent_lines(&fake), vec!["$I"]);
        fake.reply.lock().unwrap().extend([255u8, 251, 1]);
        fake.reply.lock().unwrap().extend(b"[VER:3.7 FluidNC]\r\nok\r\n");
        s.pump().unwrap();
        let l = log.0.lock().unwrap();
        assert_eq!(l.as_slice(), ["line [VER:3.7 FluidNC]", "line ok"]);
    }

    /// Über eine echte TCP-Verbindung (wie Telnet zu FluidNC) gegen eine nachgebildete Steuerung
    #[test]
    fn tcp_roundtrip_with_fake_controller() {
        use std::io::{BufRead, BufReader};
        use std::net::{TcpListener, TcpStream};
        let srv = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = srv.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (s, _) = srv.accept().unwrap();
            let mut w = s.try_clone().unwrap();
            let mut got = Vec::new();
            let mut r = BufReader::new(s);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                if r.read_until(b'\n', &mut buf).unwrap() == 0 {
                    break;
                }
                // Statusabfragen kommen ohne Zeilenende vor den Zeilen an
                let mut line = String::from_utf8_lossy(&buf).trim().to_string();
                while line.starts_with('?') {
                    line.remove(0);
                    w.write_all(b"<Idle|MPos:0.000,0.000,0.000|FS:0,0>\r\n").unwrap();
                }
                if line.is_empty() {
                    continue;
                }
                got.push(line.clone());
                w.write_all(b"ok\r\n").unwrap();
                if line == "M2" {
                    // weiter Status liefern, bis der Client trennt
                    for _ in 0..20 {
                        std::thread::sleep(Duration::from_millis(50));
                        if w.write_all(b"<Idle|MPos:0.000,0.000,0.000|FS:0,0>\r\n").is_err() {
                            break;
                        }
                    }
                    break;
                }
            }
            got
        });
        let s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_millis(10))).unwrap();
        let log = Log::default();
        let busy = Arc::new(AtomicBool::new(false));
        let (tx, rx) = std::sync::mpsc::channel();
        let lines: Vec<String> = (0..500).map(|i| format!("G1 X{}.5 Y{} S{} F3000", i % 37, i % 11, i % 1000)).chain(["M5".into(), "M2".into()]).collect();
        tx.send(Cmd::Job(lines.clone())).unwrap();
        let st = Streamer::new(s, log.clone(), busy.clone(), true);
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
        assert!(log.0.lock().unwrap().iter().any(|x| x.starts_with("done true")));
    }

    #[test]
    fn stop_sends_hold_then_reset() {
        let fake = Fake::default();
        let mut s = Streamer::new(fake.clone(), Log::default(), Arc::new(AtomicBool::new(false)), false);
        s.handle(Cmd::Job(vec!["G1 X1 F100".into(); 5])).unwrap();
        s.pump().unwrap();
        fake.written.lock().unwrap().clear();
        s.handle(Cmd::Stop).unwrap();
        assert_eq!(fake.written.lock().unwrap().as_slice(), b"!\x18");
        assert!(s.job.is_none());
        assert_eq!(s.inflight_bytes, 0);
    }
}
