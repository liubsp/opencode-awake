mod power;

use serde::Deserialize;
use std::{
    collections::HashMap,
    io::{self, BufRead, Read, Write},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const MAX_LEASE_MS: u64 = 180_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    owner: String,
    active: bool,
    #[serde(default)]
    ttl_ms: u64,
}

#[derive(Default)]
struct Leases(HashMap<String, Instant>);

impl Leases {
    fn update(&mut self, command: Update, now: Instant) -> io::Result<()> {
        if command.owner.is_empty() || command.owner.len() > 128 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid owner"));
        }
        if command.active {
            if command.ttl_ms == 0 || command.ttl_ms > MAX_LEASE_MS {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "ttl_ms must be 1..180000",
                ));
            }
            self.0
                .insert(command.owner, now + Duration::from_millis(command.ttl_ms));
        } else {
            self.0.remove(&command.owner);
        }
        Ok(())
    }

    fn expire(&mut self, now: Instant) {
        self.0.retain(|_, deadline| *deadline > now);
    }

    fn wait(&self, now: Instant) -> Duration {
        self.0
            .values()
            .map(|deadline| deadline.saturating_duration_since(now))
            .min()
            .unwrap_or(Duration::from_secs(1))
    }
}

fn emit(value: serde_json::Value) -> io::Result<()> {
    let mut out = io::stdout().lock();
    writeln!(out, "{value}")?;
    out.flush()
}

fn run() -> io::Result<()> {
    let (sender, receiver) = mpsc::sync_channel(64);
    thread::spawn(move || {
        let mut input = io::stdin().lock();
        loop {
            // Bound a malformed line instead of allowing an unbounded allocation.
            let mut line = Vec::new();
            let result = input.by_ref().take(4097).read_until(b'\n', &mut line);
            match result {
                Ok(0) => break,
                Ok(_) if line.len() <= 4096 && line.last() == Some(&b'\n') => {
                    if sender
                        .send(serde_json::from_slice::<Update>(&line).map_err(io::Error::other))
                        .is_err()
                    {
                        break;
                    }
                }
                _ => {
                    let _ = sender.send(Err(io::Error::other("invalid helper input")));
                    break;
                }
            }
        }
        // EOF (including parent death) disconnects the receiver and drops the assertion.
    });
    let mut leases = Leases::default();
    let mut assertion = None;
    let mut last_count = 0;
    emit(serde_json::json!({ "type": "ready", "protocol": 1 }))?;
    loop {
        match receiver.recv_timeout(leases.wait(Instant::now())) {
            Ok(command) => leases.update(command?, Instant::now())?,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        leases.expire(Instant::now());
        let count = leases.0.len();
        if count > 0 && assertion.is_none() {
            assertion = Some(power::Assertion::acquire()?);
        }
        if count == 0 {
            assertion = None;
        }
        if count != last_count {
            emit(
                serde_json::json!({ "type": "state", "held": assertion.is_some(), "owners": count }),
            )?;
            last_count = count;
        }
    }
    drop(assertion);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("opencode-awake-helper: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(owner: &str, active: bool, ttl_ms: u64) -> Update {
        Update {
            owner: owner.to_owned(),
            active,
            ttl_ms,
        }
    }

    #[test]
    fn releasing_one_owner_does_not_release_another() {
        let now = Instant::now();
        let mut leases = Leases::default();
        leases.update(update("a", true, 100), now).unwrap();
        leases.update(update("a", true, 100), now).unwrap();
        leases.update(update("b", true, 200), now).unwrap();
        leases.update(update("a", false, 0), now).unwrap();
        assert_eq!(leases.0.len(), 1);
        leases.expire(now + Duration::from_millis(199));
        assert_eq!(leases.0.len(), 1);
        leases.expire(now + Duration::from_millis(200));
        assert!(leases.0.is_empty());
    }

    #[test]
    fn renewal_cannot_extend_a_different_stale_owner() {
        let now = Instant::now();
        let mut leases = Leases::default();
        leases.update(update("stale", true, 100), now).unwrap();
        leases.update(update("live", true, 100), now).unwrap();
        leases
            .update(update("live", true, 100), now + Duration::from_millis(90))
            .unwrap();
        leases.expire(now + Duration::from_millis(100));
        assert!(!leases.0.contains_key("stale"));
        assert!(leases.0.contains_key("live"));
    }

    #[test]
    fn rejects_unbounded_leases() {
        let mut leases = Leases::default();
        assert!(
            leases
                .update(update("x", true, 180_001), Instant::now())
                .is_err()
        );
        assert!(leases.update(update("x", true, 0), Instant::now()).is_err());
    }
}
