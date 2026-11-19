use std::cmp::Ordering;

/// Engine release version: the tag set by the release build, else `<crate version>-dev`.
pub const RELEASE_VERSION: &str = select_release_version(option_env!("RAVEN_RELEASE_VERSION"));

/// Target triple this binary was compiled for.
pub const HOST_TARGET: &str = env!("RAVEN_TARGET_TRIPLE");

const DEV_VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "-dev");

const fn select_release_version(compiled: Option<&'static str>) -> &'static str {
    match compiled {
        Some(version) if !version.is_empty() => version,
        _ => DEV_VERSION,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
    pre: Vec<String>,
}

impl SemVer {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        let value = value.strip_prefix('v').unwrap_or(value);
        let value = value.split_once('+').map_or(value, |(core, _)| core);
        let (core, pre) = match value.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (value, None),
        };
        let mut parts = core.split('.');
        let major = numeric(parts.next()?)?;
        let minor = numeric(parts.next()?)?;
        let patch = numeric(parts.next()?)?;
        if parts.next().is_some() {
            return None;
        }
        let pre = match pre {
            None => Vec::new(),
            Some(pre) => {
                let identifiers = pre.split('.').map(str::to_owned).collect::<Vec<_>>();
                if identifiers.iter().any(|identifier| {
                    identifier.is_empty()
                        || !identifier
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                }) {
                    return None;
                }
                identifiers
            }
        };
        Some(Self {
            major,
            minor,
            patch,
            pre,
        })
    }
}

fn numeric(value: &str) -> Option<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse().ok()
}

impl Ord for SemVer {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => compare_pre(&self.pre, &other.pre),
            })
    }
}

impl PartialOrd for SemVer {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn compare_pre(left: &[String], right: &[String]) -> Ordering {
    for (left, right) in left.iter().zip(right) {
        let ordering = match (left.parse::<u64>(), right.parse::<u64>()) {
            (Ok(left), Ok(right)) => left.cmp(&right),
            (Ok(_), Err(_)) => Ordering::Less,
            (Err(_), Ok(_)) => Ordering::Greater,
            (Err(_), Err(_)) => left.cmp(right),
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left.len().cmp(&right.len())
}

/// True only when `candidate` is a strictly newer semantic version than `current`.
pub(crate) fn is_newer(candidate: &str, current: &str) -> bool {
    match (SemVer::parse(candidate), SemVer::parse(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_version_falls_back_to_the_crate_dev_version() {
        assert_eq!(select_release_version(None), "0.1.0-dev");
        assert_eq!(select_release_version(Some("")), "0.1.0-dev");
        assert_eq!(select_release_version(Some("1.4.2")), "1.4.2");
        match option_env!("RAVEN_RELEASE_VERSION") {
            Some(version) if !version.is_empty() => assert_eq!(RELEASE_VERSION, version),
            _ => assert_eq!(RELEASE_VERSION, DEV_VERSION),
        }
    }

    #[test]
    fn host_target_is_a_target_triple() {
        assert!(HOST_TARGET.split('-').count() >= 3, "{HOST_TARGET}");
    }

    #[test]
    fn semver_compare_never_offers_equal_or_older_versions() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(is_newer("0.1.0", "0.1.0-dev"));
        assert!(is_newer("1.0.0-rc.2", "1.0.0-rc.1"));
        assert!(is_newer("1.0.0-rc.10", "1.0.0-rc.9"));
        assert!(is_newer("1.0.0-beta", "1.0.0-alpha.1"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0+build.2", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(!is_newer("0.1.0-dev", "0.1.0"));
        assert!(!is_newer("1.0.0-rc.1", "1.0.0"));
    }

    #[test]
    fn unparseable_versions_are_never_newer() {
        for candidate in [
            "",
            "latest",
            "1.2",
            "1.2.3.4",
            "01.2.3",
            "1.2.x",
            "1.2.3-",
            "1.2.3-a..b",
        ] {
            assert!(!is_newer(candidate, "0.0.1"), "{candidate}");
            assert!(!is_newer("9.9.9", candidate), "{candidate}");
        }
    }
}
