use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_DECIMAL_PLACES: u8 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Money(i64);

impl Money {
    pub const fn from_minor_units(minor_units: i64) -> Self {
        Self(minor_units)
    }

    pub fn parse(value: &str, decimal_places: u8) -> Result<Self, MoneyError> {
        if decimal_places > MAX_DECIMAL_PLACES {
            return Err(MoneyError::UnsupportedPrecision(decimal_places));
        }

        let value = value.trim();
        if value.is_empty() {
            return Err(MoneyError::InvalidDecimal);
        }

        let (negative, unsigned) = match value.as_bytes().first() {
            Some(b'-') => (true, &value[1..]),
            Some(b'+') => (false, &value[1..]),
            _ => (false, value),
        };
        let (whole, fraction) = match unsigned.split_once('.') {
            Some((whole, fraction)) => (whole, Some(fraction)),
            None => (unsigned, None),
        };

        if whole.is_empty()
            || !whole.bytes().all(|byte| byte.is_ascii_digit())
            || fraction.is_some_and(|part| {
                part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit())
            })
        {
            return Err(MoneyError::InvalidDecimal);
        }

        let fraction = fraction.unwrap_or_default();
        if fraction.len() > usize::from(decimal_places) {
            return Err(MoneyError::ExcessFractionalDigits {
                supported: decimal_places,
                actual: fraction.len(),
            });
        }

        let scale = 10_i128.pow(u32::from(decimal_places));
        let whole = whole.parse::<i128>().map_err(|_| MoneyError::Overflow)?;
        let fraction = if fraction.is_empty() {
            0
        } else {
            fraction.parse::<i128>().map_err(|_| MoneyError::Overflow)?
                * 10_i128.pow(u32::from(decimal_places) - fraction.len() as u32)
        };
        let magnitude = whole
            .checked_mul(scale)
            .and_then(|whole| whole.checked_add(fraction))
            .ok_or(MoneyError::Overflow)?;
        let minor_units = if negative {
            magnitude.checked_neg().ok_or(MoneyError::Overflow)?
        } else {
            magnitude
        };

        i64::try_from(minor_units)
            .map(Self)
            .map_err(|_| MoneyError::Overflow)
    }

    pub const fn minor_units(self) -> i64 {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MoneyError {
    #[error("money value must be a plain decimal")]
    InvalidDecimal,
    #[error("currency supports {supported} fractional digits, got {actual}")]
    ExcessFractionalDigits { supported: u8, actual: usize },
    #[error("currency precision {0} is unsupported")]
    UnsupportedPrecision(u8),
    #[error("money value exceeds the supported minor-unit range")]
    Overflow,
}
