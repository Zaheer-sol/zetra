use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, serde_json, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
};

const EVENT_PREFIX: &str = "EVENT_JSON:";

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Attestations,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Attestation {
    pub publisher_id: AccountId,
    pub book_id: String,
    pub period: u32,
    pub root: String,
    pub entry_count: u32,
    pub version: u32,
    pub published_at_ns: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ZetraBooksAttestation {
    attestations: LookupMap<String, Attestation>,
}

#[near]
impl ZetraBooksAttestation {
    #[init]
    pub fn new() -> Self {
        Self {
            attestations: LookupMap::new(StorageKey::Attestations),
        }
    }

    /// Publish or update the caller's attestation for a book and calendar month.
    /// Re-publication increments a version while the event log preserves prior roots.
    #[payable]
    pub fn attest(
        &mut self,
        book_id: String,
        period: u32,
        root: String,
        entry_count: u32,
    ) -> Attestation {
        assert!(!book_id.trim().is_empty(), "book_id is required");
        assert!(book_id.len() <= 128, "book_id is too long");
        assert!(valid_period(period), "period must be YYYYMM");
        let root = normalize_root(&root);
        let publisher_id = env::predecessor_account_id();
        let storage_before = env::storage_usage();
        let key = storage_key(&publisher_id, &book_id, period);
        let version = self.attestations.get(&key).map_or(1, |current| {
            current.version.checked_add(1).expect("version overflow")
        });
        let attestation = Attestation {
            publisher_id: publisher_id.clone(),
            book_id,
            period,
            root,
            entry_count,
            version,
            published_at_ns: env::block_timestamp(),
        };
        self.attestations.insert(key, attestation.clone());
        // `store::LookupMap` batches writes; flush before measuring so the deposit is based on the
        // actual trie growth, not the in-memory cache.
        self.attestations.flush();
        refund_unused_storage_deposit(&publisher_id, storage_before);
        emit_attestation(&attestation);
        attestation
    }

    pub fn get_attestation(
        &self,
        publisher_id: AccountId,
        book_id: String,
        period: u32,
    ) -> Option<Attestation> {
        self.attestations
            .get(&storage_key(&publisher_id, &book_id, period))
            .cloned()
    }
}

/// New attestations are paid for by their publisher, so an arbitrary account cannot consume the
/// contract's storage balance. Updates usually reuse the existing allocation and refund the full
/// attached deposit.
fn refund_unused_storage_deposit(publisher_id: &AccountId, storage_before: u64) {
    let bytes_used = env::storage_usage().saturating_sub(storage_before) as u128;
    let required = env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(bytes_used)
        .expect("storage cost overflow");
    let attached = env::attached_deposit().as_yoctonear();
    assert!(attached >= required, "attach enough NEAR to cover storage");
    let refund = attached - required;
    if refund > 0 {
        Promise::new(publisher_id.clone())
            .transfer(NearToken::from_yoctonear(refund))
            .detach();
    }
}

fn storage_key(publisher_id: &AccountId, book_id: &str, period: u32) -> String {
    format!("{publisher_id}:{book_id}:{period}")
}

fn valid_period(period: u32) -> bool {
    let year = period / 100;
    let month = period % 100;
    (2000..=9999).contains(&year) && (1..=12).contains(&month)
}

fn normalize_root(root: &str) -> String {
    let hex = root.strip_prefix("0x").unwrap_or(root);
    assert!(hex.len() == 64, "root must be a 32-byte hexadecimal value");
    assert!(
        hex.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "root must be a 32-byte hexadecimal value"
    );
    format!("0x{}", hex.to_ascii_lowercase())
}

fn emit_attestation(attestation: &Attestation) {
    let event = serde_json::json!({
        "standard": "zetra_books",
        "version": "1.0.0",
        "event": "books_attested",
        "data": [{
            "publisher_id": attestation.publisher_id,
            "book_id": attestation.book_id,
            "period": attestation.period,
            "root": attestation.root,
            "entry_count": attestation.entry_count,
            "version": attestation.version,
            "published_at_ns": attestation.published_at_ns.to_string()
        }]
    });
    env::log_str(&format!("{EVENT_PREFIX}{event}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId, NearToken};

    fn account(value: &str) -> AccountId {
        value.parse().expect("valid test account ID")
    }

    fn set_context(predecessor: &str, timestamp_ns: u64) {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(account(predecessor))
            .block_timestamp(timestamp_ns)
            .attached_deposit(NearToken::from_near(1));
        testing_env!(builder.build());
    }

    #[test]
    fn stores_and_reads_only_the_callers_attestation() {
        set_context("merchant.near", 1_800_000_000_123_456_789);
        let mut contract = ZetraBooksAttestation::new();
        let saved = contract.attest(
            "org-123:live".to_string(),
            202611,
            format!("0x{}", "AB".repeat(32)),
            17,
        );

        assert_eq!(saved.publisher_id, account("merchant.near"));
        assert_eq!(saved.root, format!("0x{}", "ab".repeat(32)));
        assert_eq!(saved.version, 1);
        assert_eq!(saved.published_at_ns, 1_800_000_000_123_456_789);
        assert_eq!(
            contract.get_attestation(account("merchant.near"), "org-123:live".to_string(), 202611),
            Some(saved)
        );
        assert_eq!(
            contract.get_attestation(account("other.near"), "org-123:live".to_string(), 202611),
            None
        );
    }

    #[test]
    fn reattestation_advances_version_without_overwriting_other_periods() {
        set_context("merchant.near", 1);
        let mut contract = ZetraBooksAttestation::new();
        let first = contract.attest("book".into(), 202611, format!("0x{}", "11".repeat(32)), 3);
        let revised = contract.attest("book".into(), 202611, format!("0x{}", "22".repeat(32)), 4);
        let next_month =
            contract.attest("book".into(), 202612, format!("0x{}", "33".repeat(32)), 5);

        assert_eq!(first.version, 1);
        assert_eq!(revised.version, 2);
        assert_eq!(next_month.version, 1);
        assert_eq!(
            contract.get_attestation(account("merchant.near"), "book".into(), 202611),
            Some(revised)
        );
    }

    #[test]
    #[should_panic(expected = "period must be YYYYMM")]
    fn rejects_invalid_calendar_periods() {
        set_context("merchant.near", 1);
        ZetraBooksAttestation::new().attest(
            "book".into(),
            202613,
            format!("0x{}", "ab".repeat(32)),
            0,
        );
    }

    #[test]
    #[should_panic(expected = "root must be a 32-byte hexadecimal value")]
    fn rejects_non_hash_roots() {
        set_context("merchant.near", 1);
        ZetraBooksAttestation::new().attest("book".into(), 202611, "not-a-hash".into(), 0);
    }

    #[test]
    #[should_panic(expected = "attach enough NEAR to cover storage")]
    fn new_publishers_cannot_charge_storage_to_the_contract() {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(account("merchant.near"))
            .attached_deposit(NearToken::ZERO);
        testing_env!(builder.build());
        ZetraBooksAttestation::new().attest(
            "book".into(),
            202611,
            format!("0x{}", "ab".repeat(32)),
            1,
        );
    }
}
