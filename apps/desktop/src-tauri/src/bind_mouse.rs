//! WebKitGTK versions which omit side buttons need conversion before WebKit.
//! This is local to the main webview and explicitly enabled by the recorder.
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Default)]
struct Capture {
    sequence: u64,
    enabled: bool,
}

#[derive(Default)]
pub struct BindMouseCapture(Mutex<Capture>);

impl BindMouseCapture {
    fn set(&self, enabled: bool, sequence: u64) {
        if let Ok(mut capture) = self.0.lock() {
            if sequence > capture.sequence {
                capture.sequence = sequence;
                capture.enabled = enabled;
            }
        }
    }

    #[cfg(any(target_os = "linux", test))]
    fn enabled(&self) -> bool {
        self.0.lock().is_ok_and(|capture| capture.enabled)
    }

    #[cfg(target_os = "linux")]
    fn cancel(&self) {
        if let Ok(mut capture) = self.0.lock() {
            capture.enabled = false;
        }
    }
}

#[tauri::command]
pub fn set_bind_mouse_capture(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<BindMouseCapture>>,
    enabled: bool,
    sequence: u64,
) -> Result<(), crate::error::CommandError> {
    if window.label() != "main" {
        return Err(crate::error::CommandError::new(
            "WrongWindow",
            "Mouse recording is only available in the main window.",
        ));
    }
    state.set(enabled && window.is_focused().unwrap_or(false), sequence);
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn dom_button(button: u32) -> Option<u16> {
    match button {
        8 => Some(3),
        9 => Some(4),
        // Source only supports five mouse buttons. Preserve an unsupported
        // value so the recorder explains it instead of recording Mouse 1.
        10.. => Some(5),
        _ => None,
    }
}

#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
struct HeldButtons(std::collections::HashSet<u32>);

#[cfg(any(target_os = "linux", test))]
impl HeldButtons {
    fn press(&mut self, button: u32, enabled: bool) -> Option<(u16, bool)> {
        let dom = dom_button(button)?;
        enabled.then(|| (dom, self.0.insert(button)))
    }

    fn release(&mut self, button: u32) -> Option<u16> {
        self.0.remove(&button).then(|| dom_button(button)).flatten()
    }
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let state = Arc::new(BindMouseCapture::default());
    app.manage(state.clone());
    #[cfg(target_os = "linux")]
    if let Some(window) = app.get_webview_window("main") {
        use gtk::prelude::WidgetExt;
        use std::cell::RefCell;
        use std::rc::Rc;

        let output = window.clone();
        window.with_webview(move |webview| {
            let inner = webview.inner();
            let held = Rc::new(RefCell::new(HeldButtons::default()));
            let pressed = held.clone();
            let press_state = state.clone();
            let press_output = output.clone();
            inner.connect_button_press_event(move |_, event| {
                let Some((button, first)) = pressed.borrow_mut().press(event.button(), press_state.enabled()) else {
                    return gtk::glib::Propagation::Proceed;
                };
                if first {
                    let _ = press_output.eval(format!(
                        "window.dispatchEvent(new MouseEvent('mousedown',{{button:{button},bubbles:true,cancelable:true}}))"
                    ));
                }
                gtk::glib::Propagation::Stop
            });
            let released = held.clone();
            inner.connect_button_release_event(move |_, event| {
                let Some(button) = released.borrow_mut().release(event.button()) else {
                    return gtk::glib::Propagation::Proceed;
                };
                // The press can complete recording and disable capture before
                // release. Still consume this one release, never a later click.
                // Always deliver the matching release so the renderer can
                // retire its gesture guard after it has disabled recording.
                let _ = output.eval(format!(
                    "window.dispatchEvent(new MouseEvent('mouseup',{{button:{button},bubbles:true,cancelable:true}}))"
                ));
                gtk::glib::Propagation::Stop
            });
            inner.connect_focus_out_event(move |_, _| {
                state.cancel();
                held.borrow_mut().0.clear();
                gtk::glib::Propagation::Proceed
            });
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_only_extra_native_buttons() {
        for button in 0..8 {
            assert_eq!(dom_button(button), None);
        }
        assert_eq!(dom_button(8), Some(3));
        assert_eq!(dom_button(9), Some(4));
        assert_eq!(dom_button(10), Some(5));
        assert_eq!(dom_button(u32::MAX), Some(5));
    }

    #[test]
    fn only_a_captured_press_owns_its_release_even_after_disable() {
        let state = BindMouseCapture::default();
        let mut held = HeldButtons::default();
        assert_eq!(held.press(8, state.enabled()), None);
        assert_eq!(held.release(8), None);
        state.set(true, 1);
        assert_eq!(held.press(1, state.enabled()), None);
        assert_eq!(held.press(8, state.enabled()), Some((3, true)));
        assert_eq!(held.press(8, state.enabled()), Some((3, false)));
        state.set(false, 2);
        assert_eq!(held.release(8), Some(3));
        assert_eq!(held.release(8), None);
        assert_eq!(held.press(9, state.enabled()), None);
    }

    #[test]
    fn late_enable_and_old_cleanup_cannot_replace_a_newer_capture_decision() {
        let state = BindMouseCapture::default();
        state.set(false, 2);
        state.set(true, 1);
        assert!(!state.enabled());
        state.set(true, 3);
        state.set(false, 2);
        assert!(state.enabled());
        state.set(false, 4);
        assert!(!state.enabled());
    }
}
