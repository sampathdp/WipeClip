//! Keyboard privacy filter for the recorder's interaction metadata.
//!
//! The input monitor sees every key press system-wide. Only key
//! *combinations* that act as shortcuts (Ctrl+S, Cmd+Shift+4, Alt+Tab, F5)
//! ever leave this module; plain typing never does, so passwords, messages
//! and anything else typed during a recording are not stored. Rules:
//!
//! - Function keys, Escape and Print Screen are recorded with or without
//!   modifiers (they don't type text).
//! - Every other key is recorded only together with a command modifier:
//!   Ctrl, Alt or Win on Windows; Ctrl or Cmd on macOS.
//! - Shift alone never counts (Shift+A is typing a capital).
//! - Option alone on macOS never counts: Option+key types characters
//!   (Option+2 is "€" on many layouts).
//! - Ctrl+Alt without Win on Windows never counts for character keys: that
//!   is how AltGr arrives, which types "@", "€", "{" on most non-US layouts.
//! - Only the key's name is kept, never the character it produced, and
//!   names follow the physical key on macOS (US layout labels).
//!
//! No dependencies on the rest of the crate, so it can be unit-tested on
//! its own: `rustc --edition 2021 --test src/input/keys.rs`.

// Both platforms' tables are always compiled (and tested); only one is
// used in a given build.
#![allow(dead_code)]

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOs,
}

impl Platform {
    pub const CURRENT: Platform = if cfg!(target_os = "macos") { Platform::MacOs } else { Platform::Windows };
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Modifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// Win on Windows, Cmd on macOS.
    pub meta: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyClass {
    /// Types a character (letters, digits, punctuation, space, numpad).
    Printable,
    /// Edits or moves (Enter, Tab, Backspace, arrows, Home...).
    Navigation,
    /// F1-F24, Escape, Print Screen.
    Function,
    /// Ctrl, Alt, Shift, Win/Cmd, Caps Lock.
    Modifier,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Key {
    pub name: &'static str,
    pub class: KeyClass,
}

const fn key(name: &'static str, class: KeyClass) -> Option<Key> {
    Some(Key { name, class })
}

const F_KEYS: [&str; 24] = [
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19",
    "F20", "F21", "F22", "F23", "F24",
];
const LETTERS: [&str; 26] = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
];
const DIGITS: [&str; 10] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const NUM_DIGITS: [&str; 10] = ["Num0", "Num1", "Num2", "Num3", "Num4", "Num5", "Num6", "Num7", "Num8", "Num9"];

/// Windows virtual-key code.
pub fn windows_key(vk: u32) -> Option<Key> {
    use KeyClass::*;
    match vk {
        0x41..=0x5A => key(LETTERS[(vk - 0x41) as usize], Printable),
        0x30..=0x39 => key(DIGITS[(vk - 0x30) as usize], Printable),
        0x60..=0x69 => key(NUM_DIGITS[(vk - 0x60) as usize], Printable),
        0x70..=0x87 => key(F_KEYS[(vk - 0x70) as usize], Function),
        0x6A => key("Num*", Printable),
        0x6B => key("Num+", Printable),
        0x6D => key("Num-", Printable),
        0x6E => key("Num.", Printable),
        0x6F => key("Num/", Printable),
        0x20 => key("Space", Printable),
        0xBA => key(";", Printable),
        0xBB => key("=", Printable),
        0xBC => key(",", Printable),
        0xBD => key("-", Printable),
        0xBE => key(".", Printable),
        0xBF => key("/", Printable),
        0xC0 => key("`", Printable),
        0xDB => key("[", Printable),
        0xDC => key("\\", Printable),
        0xDD => key("]", Printable),
        0xDE => key("'", Printable),
        0x1B => key("Esc", Function),
        0x2C => key("PrintScreen", Function),
        0x0D => key("Enter", Navigation),
        0x09 => key("Tab", Navigation),
        0x08 => key("Backspace", Navigation),
        0x2E => key("Delete", Navigation),
        0x2D => key("Insert", Navigation),
        0x24 => key("Home", Navigation),
        0x23 => key("End", Navigation),
        0x21 => key("PageUp", Navigation),
        0x22 => key("PageDown", Navigation),
        0x25 => key("Left", Navigation),
        0x26 => key("Up", Navigation),
        0x27 => key("Right", Navigation),
        0x28 => key("Down", Navigation),
        0x10 | 0x11 | 0x12 | 0x14 | 0x5B | 0x5C | 0xA0..=0xA5 => key("", Modifier),
        _ => None,
    }
}

/// macOS virtual key code (kVK_*, physical position on an ANSI keyboard).
pub fn mac_key(code: u16) -> Option<Key> {
    use KeyClass::*;
    let printable = |name| key(name, Printable);
    match code {
        0x00 => printable("A"),
        0x01 => printable("S"),
        0x02 => printable("D"),
        0x03 => printable("F"),
        0x04 => printable("H"),
        0x05 => printable("G"),
        0x06 => printable("Z"),
        0x07 => printable("X"),
        0x08 => printable("C"),
        0x09 => printable("V"),
        0x0B => printable("B"),
        0x0C => printable("Q"),
        0x0D => printable("W"),
        0x0E => printable("E"),
        0x0F => printable("R"),
        0x10 => printable("Y"),
        0x11 => printable("T"),
        0x12 => printable("1"),
        0x13 => printable("2"),
        0x14 => printable("3"),
        0x15 => printable("4"),
        0x16 => printable("6"),
        0x17 => printable("5"),
        0x18 => printable("="),
        0x19 => printable("9"),
        0x1A => printable("7"),
        0x1B => printable("-"),
        0x1C => printable("8"),
        0x1D => printable("0"),
        0x1E => printable("]"),
        0x1F => printable("O"),
        0x20 => printable("U"),
        0x21 => printable("["),
        0x22 => printable("I"),
        0x23 => printable("P"),
        0x25 => printable("L"),
        0x26 => printable("J"),
        0x27 => printable("'"),
        0x28 => printable("K"),
        0x29 => printable(";"),
        0x2A => printable("\\"),
        0x2B => printable(","),
        0x2C => printable("/"),
        0x2D => printable("N"),
        0x2E => printable("M"),
        0x2F => printable("."),
        0x31 => printable("Space"),
        0x32 => printable("`"),
        0x0A => printable("§"),
        0x52..=0x59 => key(NUM_DIGITS[(code - 0x52) as usize], Printable),
        0x5B => printable("Num8"),
        0x5C => printable("Num9"),
        0x41 => printable("Num."),
        0x43 => printable("Num*"),
        0x45 => printable("Num+"),
        0x4B => printable("Num/"),
        0x4E => printable("Num-"),
        0x51 => printable("Num="),
        0x24 => key("Enter", Navigation),
        0x4C => key("Enter", Navigation), // keypad Enter
        0x30 => key("Tab", Navigation),
        0x33 => key("Backspace", Navigation),
        0x75 => key("Delete", Navigation),
        0x73 => key("Home", Navigation),
        0x77 => key("End", Navigation),
        0x74 => key("PageUp", Navigation),
        0x79 => key("PageDown", Navigation),
        0x7B => key("Left", Navigation),
        0x7C => key("Right", Navigation),
        0x7D => key("Down", Navigation),
        0x7E => key("Up", Navigation),
        0x35 => key("Esc", Function),
        0x7A => key("F1", Function),
        0x78 => key("F2", Function),
        0x63 => key("F3", Function),
        0x76 => key("F4", Function),
        0x60 => key("F5", Function),
        0x61 => key("F6", Function),
        0x62 => key("F7", Function),
        0x64 => key("F8", Function),
        0x65 => key("F9", Function),
        0x6D => key("F10", Function),
        0x67 => key("F11", Function),
        0x6F => key("F12", Function),
        0x69 => key("F13", Function),
        0x6B => key("F14", Function),
        0x71 => key("F15", Function),
        0x6A => key("F16", Function),
        0x40 => key("F17", Function),
        0x4F => key("F18", Function),
        0x50 => key("F19", Function),
        0x5A => key("F20", Function),
        // Cmd, Shift, Caps Lock, Option, Ctrl (left/right), fn.
        0x36..=0x3F => key("", Modifier),
        _ => None,
    }
}

/// The label to record for this key press, or None when it must not be
/// recorded (see the module docs).
pub fn shortcut_label(key: Key, m: Modifiers, platform: Platform) -> Option<String> {
    let allowed = match key.class {
        KeyClass::Modifier => false,
        KeyClass::Function => true,
        KeyClass::Printable | KeyClass::Navigation => match platform {
            Platform::Windows => {
                let alt_gr = m.ctrl && m.alt && !m.meta && key.class == KeyClass::Printable;
                (m.ctrl || m.alt || m.meta) && !alt_gr
            }
            Platform::MacOs => m.ctrl || m.meta,
        },
    };
    if !allowed {
        return None;
    }
    let mut parts: Vec<&str> = Vec::with_capacity(5);
    match platform {
        Platform::Windows => {
            if m.ctrl {
                parts.push("Ctrl");
            }
            if m.alt {
                parts.push("Alt");
            }
            if m.shift {
                parts.push("Shift");
            }
            if m.meta {
                parts.push("Win");
            }
        }
        Platform::MacOs => {
            if m.ctrl {
                parts.push("Ctrl");
            }
            if m.alt {
                parts.push("Option");
            }
            if m.shift {
                parts.push("Shift");
            }
            if m.meta {
                parts.push("Cmd");
            }
        }
    }
    parts.push(key.name);
    Some(parts.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: Modifiers = Modifiers { ctrl: false, alt: false, shift: false, meta: false };
    const CTRL: Modifiers = Modifiers { ctrl: true, ..NONE };
    const SHIFT: Modifiers = Modifiers { shift: true, ..NONE };
    const ALT: Modifiers = Modifiers { alt: true, ..NONE };
    const META: Modifiers = Modifiers { meta: true, ..NONE };

    fn win(vk: u32, m: Modifiers) -> Option<String> {
        shortcut_label(windows_key(vk).unwrap(), m, Platform::Windows)
    }
    fn mac(code: u16, m: Modifiers) -> Option<String> {
        shortcut_label(mac_key(code).unwrap(), m, Platform::MacOs)
    }

    #[test]
    fn plain_typing_is_never_recorded() {
        for vk in (0x41..=0x5A).chain(0x30..=0x39).chain([0x20, 0xBA, 0xDE, 0x0D, 0x08, 0x09, 0x25]) {
            assert_eq!(win(vk, NONE), None, "vk {vk:#x}");
            assert_eq!(win(vk, SHIFT), None, "shift+vk {vk:#x}");
        }
        for code in [0x00u16, 0x12, 0x31, 0x24, 0x33, 0x30] {
            assert_eq!(mac(code, NONE), None);
            assert_eq!(mac(code, SHIFT), None);
        }
    }

    #[test]
    fn shortcuts_are_recorded() {
        assert_eq!(win(0x53, CTRL).as_deref(), Some("Ctrl+S"));
        assert_eq!(win(0x53, Modifiers { shift: true, ..CTRL }).as_deref(), Some("Ctrl+Shift+S"));
        assert_eq!(win(0x09, ALT).as_deref(), Some("Alt+Tab"));
        assert_eq!(win(0x44, META).as_deref(), Some("Win+D"));
        assert_eq!(mac(0x01, META).as_deref(), Some("Cmd+S"));
        assert_eq!(mac(0x15, Modifiers { shift: true, ..META }).as_deref(), Some("Shift+Cmd+4"));
        assert_eq!(mac(0x7B, Modifiers { alt: true, ..CTRL }).as_deref(), Some("Ctrl+Option+Left"));
    }

    #[test]
    fn function_keys_always() {
        assert_eq!(win(0x74, NONE).as_deref(), Some("F5"));
        assert_eq!(win(0x1B, NONE).as_deref(), Some("Esc"));
        assert_eq!(win(0x87, SHIFT).as_deref(), Some("Shift+F24"));
        assert_eq!(mac(0x60, NONE).as_deref(), Some("F5"));
    }

    #[test]
    fn character_producing_combos_are_dropped() {
        // AltGr+Q = "@" on a German layout arrives as Ctrl+Alt+Q.
        assert_eq!(win(0x51, Modifiers { alt: true, ..CTRL }), None);
        assert_eq!(win(0x51, Modifiers { alt: true, shift: true, ..CTRL }), None);
        // ...but Ctrl+Alt+Delete-style navigation combos are fine.
        assert_eq!(win(0x2E, Modifiers { alt: true, ..CTRL }).as_deref(), Some("Ctrl+Alt+Delete"));
        // Option+2 types "€" on macOS.
        assert_eq!(mac(0x13, ALT), None);
        assert_eq!(mac(0x13, Modifiers { shift: true, ..ALT }), None);
    }

    #[test]
    fn modifiers_alone_and_unknown_keys() {
        assert_eq!(win(0x11, CTRL), None);
        assert_eq!(win(0xA0, SHIFT), None);
        assert_eq!(mac(0x37, META), None);
        assert!(windows_key(0xFF).is_none());
        assert!(mac_key(0xFF).is_none());
    }
}
