//! Loads the bundled program catalog into SQLite at startup, only when the seed changed.
//! Member answers store codes without a foreign key, so the catalog can be replaced wholesale.
use crate::reference_data::seed::{LoadResult, decompress, is_loaded, record_version, tsv_rows};
use sqlx::SqlitePool;

const SEED: &[u8] = include_bytes!("../../seeds/reference/programs.tsv.gz");
const CATALOG: &str = "programs";
const COLUMNS: usize = 5;

pub(crate) async fn load_program_catalog(db: &SqlitePool) -> LoadResult<()> {
    if is_loaded(db, CATALOG, SEED).await? {
        tracing::info!(
            component = "programs",
            operation = "load",
            outcome = "current",
            "programs.catalog_current"
        );
        return Ok(());
    }
    let text = decompress(SEED)?;
    let rows = tsv_rows::<COLUMNS>(&text);
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM programs")
        .execute(&mut *tx)
        .await?;
    // code, level, name, short_name, group_name
    for [code, level, name, short_name, group_name] in &rows {
        sqlx::query("INSERT OR IGNORE INTO programs(code, level, name, short_name, group_name) VALUES (?,?,?,?,?)")
            .bind(code).bind(level).bind(name).bind(short_name).bind(group_name)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO program_search(program_search) VALUES ('rebuild')")
        .execute(&mut *tx)
        .await?;
    record_version(&mut tx, CATALOG, SEED).await?;
    tx.commit().await?;
    tracing::info!(
        component = "programs",
        operation = "load",
        outcome = "reloaded",
        rows = rows.len(),
        "programs.catalog_loaded"
    );
    Ok(())
}
