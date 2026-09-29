//! Merges the bundled company seed into `companies`, only when the seed changed.
//!
//! Rows are never deleted here: member answers reference companies (ON DELETE CASCADE), and
//! member-added companies must survive. A seed row updates the row with its id, else the row with
//! the same name (a member-added company becomes verified), else it is inserted.
//!
//! Module map (caller-first):
//!   load_company_directory   version check → merge every row in one transaction
//!   └─ merge_row             by id → by name → insert
use crate::reference_data::seed::{LoadResult, decompress, is_loaded, record_version, tsv_rows};
use sqlx::{Sqlite, SqlitePool, Transaction};

const SEED: &[u8] = include_bytes!("../../seeds/reference/companies.tsv.gz");
const CATALOG: &str = "companies";
const COLUMNS: usize = 7;
const SEEDED_AT: &str = "2026-09-30T00:00:00Z";

pub(crate) async fn load_company_directory(db: &SqlitePool) -> LoadResult<()> {
    if is_loaded(db, CATALOG, SEED).await? {
        tracing::info!(
            component = "companies",
            operation = "load",
            outcome = "current",
            "companies.directory_current"
        );
        return Ok(());
    }
    let text = decompress(SEED)?;
    let rows = tsv_rows::<COLUMNS>(&text);
    let mut tx = db.begin().await?;
    for row in &rows {
        merge_row(&mut tx, row).await?;
    }
    record_version(&mut tx, CATALOG, SEED).await?;
    tx.commit().await?;
    tracing::info!(
        component = "companies",
        operation = "load",
        outcome = "reloaded",
        rows = rows.len(),
        "companies.directory_loaded"
    );
    Ok(())
}

// id, name, aliases, city, industry, registration, origin
async fn merge_row(tx: &mut Transaction<'_, Sqlite>, row: &[&str; COLUMNS]) -> LoadResult<()> {
    let [id, name, aliases, city, industry, registration, origin] = *row;
    let by_id = sqlx::query("UPDATE OR IGNORE companies SET name=?, aliases=?, city=?, industry=?, registration=?, origin=? WHERE id=?")
        .bind(name).bind(aliases).bind(city).bind(industry).bind(registration).bind(origin).bind(id)
        .execute(&mut **tx)
        .await?;
    if by_id.rows_affected() > 0 {
        return Ok(());
    }
    let by_name = sqlx::query("UPDATE companies SET aliases=?, city=?, industry=?, registration=?, origin = CASE WHEN origin = 'member' THEN ? ELSE origin END WHERE name = ? COLLATE NOCASE")
        .bind(aliases).bind(city).bind(industry).bind(registration).bind(origin).bind(name)
        .execute(&mut **tx)
        .await?;
    if by_name.rows_affected() > 0 {
        return Ok(());
    }
    sqlx::query("INSERT OR IGNORE INTO companies(id, name, aliases, city, industry, registration, origin, created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id).bind(name).bind(aliases).bind(city).bind(industry).bind(registration).bind(origin).bind(SEEDED_AT)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
