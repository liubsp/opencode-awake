use std::io;

#[cfg(windows)]
mod platform {
    use super::io;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
        System::{
            Power::{
                PowerClearRequest, PowerCreateRequest, PowerRequestSystemRequired, PowerSetRequest,
            },
            Threading::{REASON_CONTEXT, REASON_CONTEXT_0},
        },
    };

    pub struct Assertion(HANDLE);

    impl Assertion {
        pub fn acquire() -> io::Result<Self> {
            let mut reason: Vec<u16> = "OpenCode is running sessions\0".encode_utf16().collect();
            let context = REASON_CONTEXT {
                Version: 0, // POWER_REQUEST_CONTEXT_VERSION
                Flags: 1,   // POWER_REQUEST_CONTEXT_SIMPLE_STRING
                Reason: REASON_CONTEXT_0 {
                    SimpleReasonString: reason.as_mut_ptr(),
                },
            };
            // The API copies the reason during creation. This handle is owned solely by this object.
            let handle = unsafe { PowerCreateRequest(&context) };
            if handle == INVALID_HANDLE_VALUE || handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            if unsafe { PowerSetRequest(handle, PowerRequestSystemRequired) } == 0 {
                let error = io::Error::last_os_error();
                unsafe { CloseHandle(handle) };
                return Err(error);
            }
            Ok(Self(handle))
        }
    }

    impl Drop for Assertion {
        fn drop(&mut self) {
            unsafe {
                PowerClearRequest(self.0, PowerRequestSystemRequired);
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::io;
    use core_foundation::{
        base::TCFType,
        string::{CFString, CFStringRef},
    };

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(
            kind: CFStringRef,
            level: u32,
            name: CFStringRef,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    pub struct Assertion(u32);

    impl Assertion {
        pub fn acquire() -> io::Result<Self> {
            // The same system-only assertion as caffeinate -i. No display assertion.
            let kind = CFString::new("PreventUserIdleSystemSleep");
            let name = CFString::new("OpenCode is running sessions");
            let mut id = 0;
            let result = unsafe {
                IOPMAssertionCreateWithName(
                    kind.as_concrete_TypeRef(),
                    255,
                    name.as_concrete_TypeRef(),
                    &mut id,
                )
            };
            if result != 0 {
                return Err(io::Error::other(format!(
                    "IOPMAssertionCreateWithName returned {result}"
                )));
            }
            Ok(Self(id))
        }
    }

    impl Drop for Assertion {
        fn drop(&mut self) {
            unsafe { IOPMAssertionRelease(self.0) };
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::io;
    pub struct Assertion;
    impl Assertion {
        pub fn acquire() -> io::Result<Self> {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "only Windows and macOS are supported",
            ))
        }
    }
}

pub use platform::Assertion;
