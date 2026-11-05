//! Dedicated UART transport for the Auto-ID V1 firmware protocol.
//! This mode is separate from DAP: the experiment actively moves the gimbal.
use std::{
    collections::BTreeMap,
    fs::OpenOptions,
    io::{self, BufRead, Read, Write},
    path::Path,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use serde_json::{json, Value};

const HEADER: &str = "time_ms,yaw_pos_ref_rad,yaw_pos_fdb_rad,yaw_speed_fdb_rad_s,yaw_current_cmd,yaw_current_saturated";
const START_TIMEOUT: Duration = Duration::from_secs(5);
const EXPERIMENT_TIMEOUT: Duration = Duration::from_secs(60);
const ABORT_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_LINE: usize = 8192;

fn emit(event: Value) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{event}")?;
    stdout.flush()
}

pub fn list_ports() -> Result<(), String> {
    let ports = serialport::available_ports().map_err(|error| format!("Cannot list serial ports: {error}"))?;
    let rows: Vec<Value> = ports.into_iter().map(|port| {
        let description = match port.port_type {
            serialport::SerialPortType::UsbPort(usb) => [usb.manufacturer, usb.product, usb.serial_number].into_iter().flatten().collect::<Vec<_>>().join(" "),
            other => format!("{other:?}"),
        };
        json!({"path":port.port_name, "description":description})
    }).collect();
    emit(json!(rows)).map_err(|error| error.to_string())
}

#[derive(Default)]
struct Protocol {
    started: bool,
    header: bool,
    metadata: BTreeMap<String, f64>,
    stats: BTreeMap<String, u64>,
    samples: u64,
}

#[derive(Debug, PartialEq)]
enum Event { None, Started, Progress, Finished, Aborted }

fn fields<T: std::str::FromStr>(line: &str, prefix: &str) -> Result<BTreeMap<String, T>, String> {
    let mut values = BTreeMap::new();
    for field in line.strip_prefix(prefix).unwrap_or("").trim_start_matches(',').split(',').filter(|part| !part.is_empty()) {
        let (key, raw) = field.split_once('=').ok_or_else(|| format!("Invalid marker field: {field}"))?;
        if key.is_empty() || values.contains_key(key) { return Err(format!("Invalid marker field: {field}")); }
        let value = raw.parse::<T>().map_err(|_| format!("Invalid marker field: {field}"))?;
        values.insert(key.to_string(), value);
    }
    Ok(values)
}

impl Protocol {
    fn line(&mut self, line: &str, raw: &mut impl Write) -> Result<Event, String> {
        if line.is_empty() { return Ok(Event::None); }
        if let Some(reason) = line.strip_prefix("#AUTO_ID_ERROR,") { return Err(format!("MCU rejected Auto-ID: {reason}")); }
        if line == "#AUTO_ID_ABORTED" { return Ok(Event::Aborted); }
        if line.starts_with("#AUTO_ID_START,") {
            if self.started { return Err("Unexpected duplicate start marker".into()); }
            let metadata: BTreeMap<String, f64> = fields(line, "#AUTO_ID_START")?;
            if metadata.values().any(|value| !value.is_finite()) { return Err("Non-finite experiment metadata".into()); }
            let duration = metadata.get("T").copied().unwrap_or(0.0);
            let ratio = metadata.get("buffer_ratio").copied().unwrap_or(-1.0);
            if duration <= 0.0 || !(0.0..1.0).contains(&ratio) { return Err("Invalid experiment duration or buffer ratio".into()); }
            self.metadata = metadata;
            self.started = true;
            return Ok(Event::Started);
        }
        if !self.started { return Ok(Event::None); }
        if line == HEADER {
            if !self.header {
                writeln!(raw, "{line}").map_err(|error| format!("Cannot write raw CSV: {error}"))?;
                self.header = true;
            }
            return Ok(Event::None);
        }
        if line.starts_with("#AUTO_ID_STATS,") { self.stats = fields(line, "#AUTO_ID_STATS")?; return Ok(Event::None); }
        if line == "#AUTO_ID_END" {
            if !self.header { return Err("MCU ended the experiment without a CSV header".into()); }
            return Ok(Event::Finished);
        }
        if line.starts_with('#') { return Ok(Event::None); }
        if !self.header { return Err("Received a sample before the CSV header".into()); }
        writeln!(raw, "{line}").map_err(|error| format!("Cannot write raw CSV: {error}"))?;
        self.samples += 1;
        Ok(if self.samples % 1000 == 0 { Event::Progress } else { Event::None })
    }
}

fn argument<'a>(args: &'a [String], name: &str) -> Result<&'a str, String> {
    let index = args.iter().position(|arg| arg == name).ok_or_else(|| format!("Missing {name}"))?;
    args.get(index + 1).filter(|value| !value.is_empty() && !value.starts_with("--")).map(String::as_str).ok_or_else(|| format!("Missing value for {name}"))
}

pub fn run(args: &[String]) -> bool {
    match capture(args) {
        Ok(()) => true,
        Err(error) => { let _ = emit(json!({"type":"error", "message":error})); false }
    }
}

fn capture(args: &[String]) -> Result<(), String> {
    let port_name = argument(args, "--port")?;
    let output = argument(args, "--output")?;
    let baud = argument(args, "--baud")?.parse::<u32>().map_err(|_| "Invalid baud rate".to_string())?;
    if baud == 0 { return Err("Invalid baud rate".into()); }
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut lines = stdin.lock().lines();
        loop {
            match lines.next() {
                Some(Ok(line)) if line.trim().eq_ignore_ascii_case("abort") => { let _ = tx.send(()); break; }
                Some(Ok(_)) => continue,
                _ => { let _ = tx.send(()); break; }
            }
        }
    });
    let mut port = serialport::new(port_name, baud).timeout(Duration::from_millis(100)).open()
        .map_err(|error| format!("Cannot open serial port {port_name}: {error}"))?;
    port.clear(serialport::ClearBuffer::Input).map_err(|error| format!("Cannot clear serial input: {error}"))?;
    let mut raw = OpenOptions::new().write(true).create_new(true).open(Path::new(output))
        .map_err(|error| format!("Cannot create raw CSV {output}: {error}"))?;
    if rx.try_recv().is_ok() {
        emit(json!({"type":"aborted", "metadata":{}, "stats":{}, "samples":0, "path":output, "started":false})).map_err(|e| e.to_string())?;
        return Ok(());
    }
    // Once START is attempted every error path sends ABORT before returning.
    let result = (|| -> Result<(), String> {
        port.write_all(b"AUTO_ID_START\r\n").and_then(|_| port.flush()).map_err(|error| format!("Cannot send START: {error}"))?;
        let mut protocol = Protocol::default();
        let mut deadline = Instant::now() + START_TIMEOUT;
        let mut aborting = false;
        let mut line = Vec::new();
        let mut bytes = [0_u8; 4096];
        loop {
            if !aborting && rx.try_recv().is_ok() {
                port.write_all(b"AUTO_ID_ABORT\r\n").and_then(|_| port.flush()).map_err(|error| format!("Cannot send ABORT: {error}"))?;
                aborting = true;
                deadline = Instant::now() + ABORT_TIMEOUT;
            }
            if Instant::now() > deadline {
                return Err(if aborting { "Abort was sent but MCU did not acknowledge it" } else if !protocol.started { "Timed out waiting for #AUTO_ID_START" } else { "Timed out waiting for #AUTO_ID_END" }.into());
            }
            let count = match port.read(&mut bytes) {
                Ok(count) => count,
                Err(error) if matches!(error.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted) => continue,
                Err(error) => return Err(format!("Serial read failed: {error}")),
            };
            for &byte in &bytes[..count] {
                if byte != b'\n' {
                    line.push(byte);
                    if line.len() > MAX_LINE { return Err("Serial line exceeds maximum length".into()); }
                    continue;
                }
                let content = String::from_utf8_lossy(&line).trim().to_string();
                line.clear();
                match protocol.line(&content, &mut raw)? {
                    Event::None => {},
                    Event::Started => {
                        if !aborting { deadline = Instant::now() + EXPERIMENT_TIMEOUT; }
                        emit(json!({"type":"started", "metadata":protocol.metadata})).map_err(|error| error.to_string())?;
                    }
                    Event::Progress => {
                        raw.flush().map_err(|error| format!("Cannot flush raw CSV: {error}"))?;
                        emit(json!({"type":"progress", "samples":protocol.samples})).map_err(|error| error.to_string())?;
                    }
                    event @ (Event::Finished | Event::Aborted) => {
                        raw.flush().map_err(|error| format!("Cannot flush raw CSV: {error}"))?;
                        emit(json!({"type":if event == Event::Finished {"finished"} else {"aborted"}, "metadata":protocol.metadata, "stats":protocol.stats, "samples":protocol.samples, "path":output})).map_err(|error| error.to_string())?;
                        return Ok(());
                    }
                }
            }
        }
    })();
    if let Err(error) = result {
        let _ = port.write_all(b"AUTO_ID_ABORT\r\n");
        let _ = port.flush();
        let _ = raw.flush();
        return Err(format!("{error}; stop is unconfirmed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captures_protocol_without_rewriting_raw_rows() {
        let mut protocol = Protocol::default();
        let mut raw = Vec::new();
        assert_eq!(protocol.line("noise", &mut raw).unwrap(), Event::None);
        assert_eq!(protocol.line("#AUTO_ID_START,pitch_rad=0,T=40,buffer_ratio=0.2", &mut raw).unwrap(), Event::Started);
        protocol.line(HEADER, &mut raw).unwrap();
        protocol.line("12,1.00,2,3,-42,0", &mut raw).unwrap();
        protocol.line("#AUTO_ID_STATS,samples=1,dropped=0", &mut raw).unwrap();
        assert_eq!(protocol.line("#AUTO_ID_END", &mut raw).unwrap(), Event::Finished);
        assert_eq!(String::from_utf8(raw).unwrap(), format!("{HEADER}\n12,1.00,2,3,-42,0\n"));
        assert_eq!(protocol.samples, 1);
        assert_eq!(protocol.stats["dropped"], 0);
    }
    #[test]
    fn catches_bad_metadata_missing_header_and_mcu_rejection() {
        let mut p = Protocol::default();
        let mut raw = Vec::new();
        assert!(p.line("#AUTO_ID_START,T=40,buffer_ratio=NaN", &mut raw).is_err());
        assert!(p.line("#AUTO_ID_ERROR,gimbal_not_ready", &mut raw).is_err());
        p.line("#AUTO_ID_START,T=40,buffer_ratio=0.2", &mut raw).unwrap();
        assert!(p.line("garbage", &mut raw).is_err());
        assert!(p.line("#AUTO_ID_END", &mut raw).is_err());
        assert_eq!(p.line("#AUTO_ID_ABORTED", &mut raw).unwrap(), Event::Aborted);
    }
}
