//! Loads the bundled school directory into SQLite at startup, only when the seed changed.
//!
//! Module map (caller-first):
//!   load_school_directory   version check → replace rows → rebuild the FTS index
//!   └─ replace_directory    one transaction: delete, insert, rebuild, record version
use crate::reference_data::seed::{LoadResult, decompress, is_loaded, record_version, tsv_rows};
use sqlx::SqlitePool;

const SEED: &[u8] = include_bytes!("../../seeds/reference/schools.tsv.gz");
const CATALOG: &str = "schools";
const COLUMNS: usize = 8;

// Mental model: the seed is the source of truth; its hash decides whether the tables are stale.
pub(crate) async fn load_school_directory(db: &SqlitePool) -> LoadResult<()> {
    if is_loaded(db, CATALOG, SEED).await? {
        tracing::info!(
            component = "schools",
            operation = "load",
            outcome = "current",
            "schools.directory_current"
        );
        return Ok(());
    }
    let text = decompress(SEED)?;
    let rows = tsv_rows::<COLUMNS>(&text);
    replace_directory(db, &rows).await?;
    tracing::info!(
        component = "schools",
        operation = "load",
        outcome = "reloaded",
        rows = rows.len(),
        "schools.directory_loaded"
    );
    Ok(())
}

// code, name, acronym, level, sector, city, province, region_code
async fn replace_directory(db: &SqlitePool, rows: &[[&str; COLUMNS]]) -> LoadResult<()> {
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
    record_version(&mut tx, CATALOG, SEED).await?;
    tx.commit().await?;
    Ok(())
}
