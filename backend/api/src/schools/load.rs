//! Loads the bundled school directory into SQLite at startup, only when the seed changed.
//!
//! Module map (caller-first):
//!   load_school_directory   compare versions → replace rows → rebuild the FTS index
//!   ├─ seed_version         SHA-256 of the compressed seed
//!   ├─ decompress_seed      gzip → TSV text
//!   ├─ parse_row            one TSV line → the eight column values
//!   └─ replace_directory    one transaction: delete, insert, rebuild, record version
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::io::Read;

const SEED: &[u8] = include_bytes!("../../seeds/reference/schools.tsv.gz");
const CATALOG: &str = "schools";
const COLUMNS: usize = 8;

type LoadResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

// Mental model: the seed is the source of truth; its hash decides whether the tables are stale.
pub(crate) async fn load_school_directory(db: &SqlitePool) -> LoadResult<()> {
    let version = seed_version();
    let loaded: Option<(String,)> =
        sqlx::query_as("SELECT version FROM reference_catalog_versions WHERE catalog = ?")
            .bind(CATALOG)
            .fetch_optional(db)
            .await?;
    if loaded.is_some_and(|(current,)| current == version) {
        tracing::info!(
            component = "schools",
            operation = "load",
            outcome = "current",
            "schools.directory_current"
        );
        return Ok(());
    }
    let text = decompress_seed()?;
    let rows: Vec<[&str; COLUMNS]> = text.lines().skip(1).filter_map(parse_row).collect();
    replace_directory(db, &rows, &version).await?;
    tracing::info!(
        component = "schools",
        operation = "load",
        outcome = "reloaded",
        rows = rows.len(),
        "schools.directory_loaded"
    );
    Ok(())
}

fn seed_version() -> String {
    hex::encode(Sha256::digest(SEED))
}

fn decompress_seed() -> LoadResult<String> {
    let mut text = String::new();
    flate2::read::GzDecoder::new(SEED).read_to_string(&mut text)?;
    Ok(text)
}

// code, name, acronym, level, sector, city, province, region_code
fn parse_row(line: &str) -> Option<[&str; COLUMNS]> {
    let fields: Vec<&str> = line.split('\t').collect();
    fields.try_into().ok()
}

async fn replace_directory(
    db: &SqlitePool,
    rows: &[[&str; COLUMNS]],
    version: &str,
) -> LoadResult<()> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM schools").execute(&mut *tx).await?;
    for [code, name, acronym, level, sector, city, province, region] in rows {
        sqlx::query("INSERT OR IGNORE INTO schools(code,name,acronym,level,sector,city,province,region_code) VALUES (?,?,?,?,?,?,?,?)")
            .bind(code).bind(name).bind(acronym).bind(level).bind(sector).bind(city).bind(province).bind(region)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO school_search(school_search) VALUES ('rebuild')")
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO reference_catalog_versions(catalog, version) VALUES (?, ?) ON CONFLICT(catalog) DO UPDATE SET version = excluded.version")
        .bind(CATALOG)
        .bind(version)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
