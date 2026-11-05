use std::{collections::HashMap, path::Path, time::Duration};

use studio_core::{ScalarKind, VariableDescriptor};

use crate::{Backend, Breakpoint, ProbeConfig, RegisterValue, StepKind, WatchSpec};

/// Synthetic 64x48 RGB565 frame buffer so image views have something to show.
pub const MOCK_FRAME_ADDRESS: u64 = 0x2001_0000;
pub const MOCK_FRAME_WIDTH: u64 = 64;
pub const MOCK_FRAME_HEIGHT: u64 = 48;
const MOCK_ENTRY_PC: u64 = 0x0800_0400;

pub struct MockBackend {
    running: bool,
    phase: f64,
    pc: u64,
    steps: u64,
    memory: HashMap<u64, u8>,
}

impl Default for MockBackend {
    fn default() -> Self {
        Self {
            running: false,
            phase: 0.0,
            pc: MOCK_ENTRY_PC,
            steps: 0,
            memory: HashMap::new(),
        }
    }
}

impl MockBackend {
    /// Byte of the animated frame buffer, or `None` outside of it.
    fn frame_byte(&self, address: u64) -> Option<u8> {
        let size = MOCK_FRAME_WIDTH * MOCK_FRAME_HEIGHT * 2;
        if !(MOCK_FRAME_ADDRESS..MOCK_FRAME_ADDRESS + size).contains(&address) {
            return None;
        }
        let offset = address - MOCK_FRAME_ADDRESS;
        let pixel = offset / 2;
        let (x, y) = ((pixel % MOCK_FRAME_WIDTH) as f64, (pixel / MOCK_FRAME_WIDTH) as f64);
        let t = self.phase * 4.0;
        let r = (((x / 9.0 + t).sin() * 0.5 + 0.5) * 31.0) as u16;
        let g = (((y / 7.0 - t * 0.7).cos() * 0.5 + 0.5) * 63.0) as u16;
        let b = ((((x + y) / 11.0 + t * 0.4).sin() * 0.5 + 0.5) * 31.0) as u16;
        let rgb565 = (r << 11) | (g << 5) | b;
        Some(rgb565.to_le_bytes()[(offset % 2) as usize])
    }
}

impl Backend for MockBackend {
    fn name(&self) -> String {
        "Mock Probe".into()
    }
    fn catalog(&self) -> Vec<VariableDescriptor> {
        mock_catalog()
    }
    fn connect(&mut self, _: &ProbeConfig) -> Result<(), String> {
        self.running = false;
        Ok(())
    }
    fn target_state(&mut self) -> Result<studio_core::TargetState, String> {
        Ok(if self.running {
            studio_core::TargetState::Running
        } else {
            studio_core::TargetState::Halted {
                reason: "entry".into(),
            }
        })
    }
    fn disconnect(&mut self) {
        self.running = false;
    }
    fn halt(&mut self) -> Result<(), String> {
        self.running = false;
        Ok(())
    }
    fn resume(&mut self) -> Result<(), String> {
        self.running = true;
        Ok(())
    }
    fn reset(&mut self) -> Result<(), String> {
        self.phase = 0.0;
        self.pc = MOCK_ENTRY_PC;
        self.steps = 0;
        self.running = false;
        Ok(())
    }
    fn step(&mut self, kind: StepKind) -> Result<(), String> {
        self.phase += 0.01;
        self.steps += 1;
        self.pc += match kind {
            StepKind::In => 2,
            StepKind::Over => 4,
            StepKind::Out => 16,
        };
        Ok(())
    }
    fn set_breakpoints(&mut self, _: &[Breakpoint]) -> Result<(), String> {
        Ok(())
    }
    fn run_to_address(&mut self, _: u64, _: &[Breakpoint], _: Duration) -> Result<(), String> {
        self.running = false;
        Ok(())
    }
    fn read_registers(&mut self) -> Result<Vec<RegisterValue>, String> {
        let mut registers = (0..13_u64)
            .map(|index| RegisterValue {
                name: format!("R{index}"),
                value: format!("0x{:08x}", index * 0x0101_0101 + self.steps * (index + 1)),
            })
            .collect::<Vec<_>>();
        let fixed = [
            ("SP", 0x2000_7fe0 - (self.steps % 8) * 8),
            ("LR", 0x0800_0201),
            ("PC", self.pc),
            ("XPSR", 0x0100_0000 | ((self.steps % 4) << 28)),
            ("MSP", 0x2000_7fe0 - (self.steps % 8) * 8),
            ("PSP", 0x2000_4000),
            ("PRIMASK", 0),
            ("BASEPRI", 0),
            ("FAULTMASK", 0),
            ("CONTROL", 0),
        ];
        registers.extend(fixed.into_iter().map(|(name, value)| RegisterValue {
            name: name.into(),
            value: format!("0x{value:08x}"),
        }));
        Ok(registers)
    }
    fn read_memory(&mut self, address: u64, data: &mut [u8]) -> Result<(), String> {
        for (index, byte) in data.iter_mut().enumerate() {
            let at = address + index as u64;
            *byte = self
                .memory
                .get(&at)
                .copied()
                .or_else(|| self.frame_byte(at))
                .unwrap_or(0);
        }
        Ok(())
    }
    fn write_memory(&mut self, address: u64, data: &[u8]) -> Result<(), String> {
        for (index, byte) in data.iter().enumerate() {
            self.memory.insert(address + index as u64, *byte);
        }
        Ok(())
    }
    fn flash(&mut self, path: &Path, _: bool, _: bool) -> Result<(), String> {
        if path.exists() {
            self.phase = 0.0;
            Ok(())
        } else {
            Err(format!("program does not exist: {}", path.display()))
        }
    }
    fn sample(&mut self, watches: &[WatchSpec], frames: usize) -> Result<Vec<f64>, String> {
        let mut values = Vec::with_capacity(watches.len() * frames);
        for _ in 0..frames {
            self.phase += 1.0 / 1000.0;
            for watch in watches {
                let value = memory_value(&self.memory, watch).unwrap_or_else(|| {
                    if watch.pointer_address.is_some() { return f64::NAN; }
                    match watch.id.as_str() {
                        "mock.sine" => (self.phase * std::f64::consts::TAU * 37.0).sin(),
                        "mock.cosine" => (self.phase * std::f64::consts::TAU * 11.0).cos() * 0.6,
                        "mock.ramp" => (self.phase * 2.0) % 2.0 - 1.0,
                        "mock.noise" => pseudo_noise((self.phase * 1_000_000.0) as u64),
                        // Attitude in degrees: gentle motion plus a constant yaw drift,
                        // so IMU views have zero drift to show.
                        "mock.imu.roll" => 12.0 * (self.phase * std::f64::consts::TAU * 0.23).sin(),
                        "mock.imu.pitch" => 8.0 * (self.phase * std::f64::consts::TAU * 0.17 + 1.0).sin(),
                        "mock.imu.yaw" => {
                            let yaw = 25.0 * (self.phase * std::f64::consts::TAU * 0.05).sin() + 1.5 * self.phase;
                            (yaw + 180.0).rem_euclid(360.0) - 180.0
                        }
                        _ => 0.0,
                    }
                });
                values.push(value);
            }
        }
        Ok(values)
    }
}

fn descriptor(id: &str, name: &str, expression: &str, address: u64) -> VariableDescriptor {
    VariableDescriptor {
        id: id.into(),
        name: name.into(),
        expression: expression.into(),
        type_name: "float".into(),
        address: Some(address),
        pointer_address: None,
        pointer_offset: None,
        byte_width: 4,
        scalar_kind: ScalarKind::Float32,
        writable: true,
        children: Vec::new(),
    }
}
pub fn mock_catalog() -> Vec<VariableDescriptor> {
    vec![
        VariableDescriptor {
            id: "mock.signal".into(),
            name: "signal".into(),
            expression: "signal".into(),
            type_name: "MockSignals".into(),
            address: Some(0x2000_0000),
            pointer_address: None,
            pointer_offset: None,
            byte_width: 8,
            scalar_kind: ScalarKind::Unsigned,
            writable: false,
            children: vec![
                descriptor("mock.sine", "sine_37hz", "signal.sine_37hz", 0x2000_0000),
                descriptor(
                    "mock.cosine",
                    "cosine_11hz",
                    "signal.cosine_11hz",
                    0x2000_0004,
                ),
            ],
        },
        VariableDescriptor {
            id: "mock.imu".into(),
            name: "imu".into(),
            expression: "imu".into(),
            type_name: "ImuAttitude".into(),
            address: Some(0x2000_0010),
            pointer_address: None,
            pointer_offset: None,
            byte_width: 12,
            scalar_kind: ScalarKind::Unsigned,
            writable: false,
            children: vec![
                descriptor("mock.imu.roll", "roll", "imu.roll", 0x2000_0010),
                descriptor("mock.imu.pitch", "pitch", "imu.pitch", 0x2000_0014),
                descriptor("mock.imu.yaw", "yaw", "imu.yaw", 0x2000_0018),
            ],
        },
        descriptor("mock.ramp", "control.ramp", "control.ramp", 0x2000_0008),
        descriptor("mock.noise", "adc.noise", "adc.noise", 0x2000_000c),
    ]
}
fn memory_value(memory: &HashMap<u64, u8>, watch: &WatchSpec) -> Option<f64> {
    let address = if let Some(pointer_address) = watch.pointer_address {
        let bytes = (0..4).map(|index| memory.get(&(pointer_address + index)).copied()).collect::<Option<Vec<_>>>()?;
        let base = u32::from_le_bytes(bytes.try_into().ok()?) as u64;
        if base == 0 { return None; }
        base.saturating_add(watch.pointer_offset)
    } else {
        watch.address
    };
    let width = usize::from(watch.byte_width);
    let bytes = (0..width)
        .map(|index| memory.get(&(address + index as u64)).copied())
        .collect::<Option<Vec<_>>>()?;
    let mut raw = [0_u8; 8];
    raw[..width.min(8)].copy_from_slice(&bytes[..width.min(8)]);
    Some(match (watch.scalar_kind, width) {
        (ScalarKind::Float32, 4) => f32::from_le_bytes(raw[..4].try_into().ok()?) as f64,
        (ScalarKind::Float64, 8) => f64::from_le_bytes(raw),
        (ScalarKind::Boolean, _) => (raw[0] != 0) as u8 as f64,
        (ScalarKind::Unsigned, _) => u64::from_le_bytes(raw) as f64,
        (ScalarKind::Signed, 1) => i8::from_le_bytes([raw[0]]) as f64,
        (ScalarKind::Signed, 2) => i16::from_le_bytes(raw[..2].try_into().ok()?) as f64,
        (ScalarKind::Signed, 4) => i32::from_le_bytes(raw[..4].try_into().ok()?) as f64,
        (ScalarKind::Signed, 8) => i64::from_le_bytes(raw) as f64,
        _ => return None,
    })
}
fn pseudo_noise(mut value: u64) -> f64 {
    value ^= value << 13;
    value ^= value >> 7;
    value ^= value << 17;
    (value as i64 as f64 / i64::MAX as f64).clamp(-1.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn samples_are_interleaved_by_frame() {
        let mut backend = MockBackend::default();
        let watches = vec![
            WatchSpec {
                id: "mock.sine".into(),
                address: 0,
                pointer_address: None,
                pointer_offset: 0,
                byte_width: 4,
                scalar_kind: ScalarKind::Float32,
            },
            WatchSpec {
                id: "mock.ramp".into(),
                address: 4,
                pointer_address: None,
                pointer_offset: 0,
                byte_width: 4,
                scalar_kind: ScalarKind::Float32,
            },
        ];
        assert_eq!(backend.sample(&watches, 3).unwrap().len(), 6);
    }

    #[test]
    fn written_mock_value_overrides_the_synthetic_signal() {
        let mut backend = MockBackend::default();
        backend
            .write_memory(0x2000_0000, &12.5_f32.to_le_bytes())
            .unwrap();
        let watch = WatchSpec {
            id: "mock.sine".into(),
            address: 0x2000_0000,
            pointer_address: None,
            pointer_offset: 0,
            byte_width: 4,
            scalar_kind: ScalarKind::Float32,
        };
        assert_eq!(backend.sample(&[watch], 1).unwrap(), vec![12.5]);
    }

    #[test]
    fn pointer_watches_follow_the_current_pointee() {
        let mut backend = MockBackend::default();
        let pointer_address = 0x2000_0100;
        let first = 0x2000_0200_u32;
        let second = 0x2000_0300_u32;
        backend.write_memory(pointer_address, &first.to_le_bytes()).unwrap();
        backend.write_memory(u64::from(first) + 4, &1.5_f32.to_le_bytes()).unwrap();
        backend.write_memory(u64::from(second) + 4, &2.5_f32.to_le_bytes()).unwrap();
        let watch = WatchSpec {
            id: "pointer.value".into(), address: 0, pointer_address: Some(pointer_address),
            pointer_offset: 4, byte_width: 4, scalar_kind: ScalarKind::Float32,
        };
        assert_eq!(backend.sample(std::slice::from_ref(&watch), 1).unwrap(), vec![1.5]);
        backend.write_memory(pointer_address, &second.to_le_bytes()).unwrap();
        assert_eq!(backend.sample(&[watch], 1).unwrap(), vec![2.5]);
    }

    #[test]
    fn frame_buffer_reads_are_non_zero_and_steps_advance_pc() {
        let mut backend = MockBackend::default();
        let mut frame = vec![0_u8; (MOCK_FRAME_WIDTH * MOCK_FRAME_HEIGHT * 2) as usize];
        backend.read_memory(MOCK_FRAME_ADDRESS, &mut frame).unwrap();
        assert!(frame.iter().any(|byte| *byte != 0));
        let pc = |backend: &mut MockBackend| {
            backend.read_registers().unwrap().into_iter().find(|r| r.name == "PC").unwrap().value
        };
        let before = pc(&mut backend);
        backend.step(StepKind::Over).unwrap();
        assert_ne!(before, pc(&mut backend));
    }

    #[test]
    fn null_pointer_watches_are_unavailable_without_failing_other_channels() {
        let mut backend = MockBackend::default();
        let watches = [
            WatchSpec { id: "pointer.value".into(), address: 0, pointer_address: Some(0x2000_0100), pointer_offset: 4, byte_width: 4, scalar_kind: ScalarKind::Float32 },
            WatchSpec { id: "mock.ramp".into(), address: 4, pointer_address: None, pointer_offset: 0, byte_width: 4, scalar_kind: ScalarKind::Float32 },
        ];
        let values = backend.sample(&watches, 1).unwrap();
        assert!(values[0].is_nan());
        assert!(values[1].is_finite());
    }
}
