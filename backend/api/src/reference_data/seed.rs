//! A bundled seed is loaded only when its content changed since the last load.
//!
//! Module map (caller-first):
//!   is_loaded        the stored version for this catalog equals the seed's SHA-256
//!   seed_version     SHA-256 of the compressed bytes
//!   tsv_rows         gzip → text → rows of exactly N tab-separated fields (header skipped)
//!   record_version   remember which seed version is loaded (inside the loader's transaction)
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::io::Read;

pub(crate) type LoadResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub(crate) async fn is_loaded(db: &SqlitePool, catalog: &str, seed: &[u8]) -> LoadResult<bool> {
    let loaded: Option<(String,)> =
        sqlx::query_as("SELECT version FROM reference_catalog_versions WHERE catalog = ?")
            .bind(catalog)
            .fetch_optional(db)
            .await?;
    Ok(loaded.is_some_and(|(current,)| current == seed_version(seed)))
}

pub(crate) fn seed_version(seed: &[u8]) -> String {
    hex::encode(Sha256::digest(seed))
}

/// The decompressed text; rows borrow from it (see `tsv_rows`).
pub(crate) fn decompress(seed: &[u8]) -> LoadResult<String> {
    let mut text = String::new();
    flate2::read::GzDecoder::new(seed).read_to_string(&mut text)?;
    Ok(text)
}

pub(crate) fn tsv_rows<const N: usize>(text: &str) -> Vec<[&str; N]> {
    text.lines()
        .skip(1)
        .filter_map(|line| line.split('\t').collect::<Vec<_>>().try_into().ok())
        .collect()
}

pub(crate) async fn record_version(
    tx: &mut Transaction<'_, Sqlite>,
    catalog: &str,
    seed: &[u8],
) -> LoadResult<()> {
    sqlx::query("INSERT INTO reference_catalog_versions(catalog, version) VALUES (?, ?) ON CONFLICT(catalog) DO UPDATE SET version = excluded.version")
        .bind(catalog)
        .bind(seed_version(seed))
        .execute(&mut **tx)
        .await?;
    Ok(())
}
