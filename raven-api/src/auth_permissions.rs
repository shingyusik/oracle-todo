use std::io::Read;
use std::path::Path;

use crate::auth::AuthConfigError;

const MAX_FILE_BYTES: u64 = 4 * 1024 + 2;

pub fn read_secure_token_file(path: &Path) -> Result<Vec<u8>, AuthConfigError> {
    let file = open_secure(path)?;
    let metadata = file
        .metadata()
        .map_err(|_| AuthConfigError::InvalidTokenFile)?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(AuthConfigError::InvalidTokenFile);
    }
    inspect_permissions(&file, &metadata)?;

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AuthConfigError::InvalidTokenFile)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(AuthConfigError::InvalidTokenFile);
    }
    Ok(bytes)
}

#[cfg(unix)]
fn open_secure(path: &Path) -> Result<std::fs::File, AuthConfigError> {
    let fd = rustix::fs::open(
        path,
        rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::CLOEXEC | rustix::fs::OFlags::NOFOLLOW,
        rustix::fs::Mode::empty(),
    )
    .map_err(|_| AuthConfigError::InvalidTokenFile)?;
    Ok(fd.into())
}

#[cfg(unix)]
fn inspect_permissions(
    _file: &std::fs::File,
    metadata: &std::fs::Metadata,
) -> Result<(), AuthConfigError> {
    use std::os::unix::fs::MetadataExt;

    if metadata.uid() != rustix::process::geteuid().as_raw() || metadata.mode() & 0o077 != 0 {
        return Err(AuthConfigError::InvalidTokenFile);
    }
    Ok(())
}

#[cfg(windows)]
fn open_secure(path: &Path) -> Result<std::fs::File, AuthConfigError> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| AuthConfigError::InvalidTokenFile)
}

#[cfg(windows)]
fn inspect_permissions(
    file: &std::fs::File,
    metadata: &std::fs::Metadata,
) -> Result<(), AuthConfigError> {
    windows::inspect(file, metadata)
}

#[cfg(not(any(unix, windows)))]
compile_error!("secure Raven API token files are unsupported on this platform");

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, CreateWellKnownSid, DACL_SECURITY_INFORMATION,
        EqualSid, GetAce, GetLengthSid, GetSecurityDescriptorControl, GetTokenInformation,
        INHERITED_ACE, PSECURITY_DESCRIPTOR, PSID, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
        TokenUser, WinBuiltinAdministratorsSid, WinLocalSystemSid,
    };
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    use super::AuthConfigError;

    struct LocalDescriptor(PSECURITY_DESCRIPTOR);

    impl Drop for LocalDescriptor {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: GetSecurityInfo allocates this descriptor with LocalAlloc.
                unsafe {
                    LocalFree(self.0.cast());
                }
            }
        }
    }

    struct Handle(windows_sys::Win32::Foundation::HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: OpenProcessToken returned this owned handle.
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    pub fn inspect(
        file: &std::fs::File,
        metadata: &std::fs::Metadata,
    ) -> Result<(), AuthConfigError> {
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(AuthConfigError::InvalidTokenFile);
        }

        let mut dacl: *mut ACL = null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
        // SAFETY: pointers remain valid for the call and the descriptor is freed below.
        let status = unsafe {
            GetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut descriptor,
            )
        };
        if status != 0 || descriptor.is_null() || dacl.is_null() {
            return Err(AuthConfigError::InvalidTokenFile);
        }
        let descriptor = LocalDescriptor(descriptor);

        let mut control = 0u16;
        let mut revision = 0u32;
        // SAFETY: descriptor is valid while LocalDescriptor is alive.
        if unsafe { GetSecurityDescriptorControl(descriptor.0, &mut control, &mut revision) } == 0
            || control & SE_DACL_PROTECTED == 0
        {
            return Err(AuthConfigError::InvalidTokenFile);
        }

        let current = current_user_sid()?;
        let admins = well_known_sid(WinBuiltinAdministratorsSid)?;
        let system = well_known_sid(WinLocalSystemSid)?;
        for index in 0..unsafe { (*dacl).AceCount } as u32 {
            let mut ace: *mut c_void = null_mut();
            // SAFETY: DACL came from GetSecurityInfo; GetAce validates the index.
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 || ace.is_null() {
                return Err(AuthConfigError::InvalidTokenFile);
            }
            // SAFETY: every ACE begins with ACE_HEADER.
            let header = unsafe { &*(ace.cast::<ACE_HEADER>()) };
            if u32::from(header.AceFlags) & INHERITED_ACE != 0 {
                return Err(AuthConfigError::InvalidTokenFile);
            }
            // ACCESS_ALLOWED_ACE and ACCESS_DENIED_ACE share the SidStart offset.
            if header.AceType > 1 {
                return Err(AuthConfigError::InvalidTokenFile);
            }
            // SAFETY: basic allow/deny ACEs share this layout through SidStart.
            let sid = unsafe {
                std::ptr::addr_of!((*ace.cast::<ACCESS_ALLOWED_ACE>()).SidStart).cast_mut()
            };
            if !sid_equals_any(sid.cast(), [&current, &admins, &system]) {
                return Err(AuthConfigError::InvalidTokenFile);
            }
        }
        Ok(())
    }

    fn current_user_sid() -> Result<Vec<u8>, AuthConfigError> {
        let mut token = null_mut();
        // SAFETY: output pointer is valid.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(AuthConfigError::InvalidTokenFile);
        }
        let token = Handle(token);
        let mut needed = 0u32;
        // SAFETY: null buffer query is the documented sizing call.
        unsafe {
            GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut needed);
        }
        if needed == 0 {
            return Err(AuthConfigError::InvalidTokenFile);
        }
        let mut buffer = vec![0u8; needed as usize];
        // SAFETY: buffer is sized by the preceding call.
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                needed,
                &mut needed,
            )
        } == 0
        {
            return Err(AuthConfigError::InvalidTokenFile);
        }
        // SAFETY: the successful query populated TOKEN_USER and its SID pointer.
        let token_user = unsafe { buffer.as_ptr().cast::<TOKEN_USER>().read_unaligned() };
        let sid = token_user.User.Sid;
        // SAFETY: SID came from GetTokenInformation.
        let sid_len = unsafe { GetLengthSid(sid) };
        if sid_len == 0 {
            return Err(AuthConfigError::InvalidTokenFile);
        }
        // SAFETY: GetLengthSid reports the readable SID byte length.
        Ok(unsafe { std::slice::from_raw_parts(sid.cast::<u8>(), sid_len as usize) }.to_vec())
    }

    fn well_known_sid(kind: i32) -> Result<Vec<u8>, AuthConfigError> {
        let mut size = 0u32;
        // SAFETY: null buffer query is the documented sizing call.
        unsafe {
            CreateWellKnownSid(kind, null_mut(), null_mut(), &mut size);
        }
        if size == 0 {
            return Err(AuthConfigError::InvalidTokenFile);
        }
        let mut sid = vec![0u8; size as usize];
        // SAFETY: buffer is sized by the preceding call.
        if unsafe { CreateWellKnownSid(kind, null_mut(), sid.as_mut_ptr().cast(), &mut size) } == 0
        {
            return Err(AuthConfigError::InvalidTokenFile);
        }
        Ok(sid)
    }

    fn sid_equals_any<const N: usize>(sid: PSID, allowed: [&Vec<u8>; N]) -> bool {
        allowed.into_iter().any(|buffer| {
            let candidate = buffer.as_ptr().cast_mut().cast();
            // SAFETY: both pointers refer to SIDs returned by Win32.
            unsafe { EqualSid(sid, candidate) != 0 }
        })
    }
}
