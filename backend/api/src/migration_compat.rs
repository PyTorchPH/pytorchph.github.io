//! Reconcile only audited historical checksums after removing embedded private seed content.
//! Unknown checksums and unsuccessful migrations retain SQLx's normal failure behavior.
use sqlx::{
    SqlitePool,
    migrate::{MigrateError, Migrator},
};
const APPROVED: &[(i64, &str)] = &[
    // Historical Windows deployment: SQL is identical; only CRLF differs from CI LF.
    (
        26,
        "9ee70a82b77206c5026e2bf21927a7ea3d10a850900ae54b53ed836590b58e56051bd7b95fbbe03100bdc89b9a8b0f32",
    ),
    (
        11,
        "20db2cf459d74085f5eba3117b5f02d2a595f63927fdbf306e47680c472e9945ffc357d84bbad46a44c5bead1b9889a8",
    ),
    (
        11,
        "d9b8e0c329c3702277fc549edbe5c034b60d76dee6c2c2305802dcbbb87f7a3e2d1277daec584fcf2a04540dcade994e",
    ),
    (
        27,
        "054dd72a64c0403458db2bfbeaece3144fb3ca185d1cb07c7f77ff1a96c684b1f7e7ed6b1cb9a06a90a4a11da72e2fa5",
    ),
    (
        27,
        "74ad0b619e301e4ed902afe5568900bde44111dc3d5e0c49e3825ed3f1d4817a42f1b3fb2fe67cc71b5a1228af9ca446",
    ),
    (
        30,
        "5863a86324d784f8cada1873dd9c4302ca9f7711f9d0660edaa2c9326fbb28e6a5f99d582af36013187a0ab08ea43018",
    ),
    (
        30,
        "68f96c8fed3822caec461cca092ad940ba13e27256a7b4c3b1818a70ab1968e80dd1e432f2d77daa73588a85a3309528",
    ),
];

pub(crate) async fn run(db: &SqlitePool) -> Result<(), MigrateError> {
    let migrator = sqlx::migrate!();
    reconcile(db, &migrator).await?;
    migrator.run(db).await
}

async fn reconcile(db: &SqlitePool, migrator: &Migrator) -> Result<(), MigrateError> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
    )
    .fetch_one(db)
    .await?;
    if exists == 0 {
        return Ok(());
    }
    let mut tx = db.begin().await?;
    for &(version, original) in APPROVED {
        let Some(migration) = migrator.iter().find(|entry| entry.version == version) else {
            continue;
        };
        let changed = sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=? AND success=1 AND lower(hex(checksum))=?")
            .bind(migration.checksum.as_ref()).bind(version).bind(original).execute(&mut *tx).await?;
        if changed.rows_affected() > 0 {
            tracing::info!(
                component = "migrations",
                operation = "reconcile_audited_seed_cleanup",
                version,
                "migrations.checksum_reconciled"
            );
        }
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn only_known_successful_checksums_are_reconciled_without_touching_rows() {
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run(&db).await.unwrap();
        sqlx::query("INSERT INTO position_reservations VALUES ('runtime@example.test','cto')")
            .execute(&db)
            .await
            .unwrap();
        for &(version, checksum) in APPROVED {
            sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
                .bind(hex::decode(checksum).unwrap())
                .bind(version)
                .execute(&db)
                .await
                .unwrap();
            run(&db).await.unwrap();
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM position_reservations")
                .fetch_one(&db)
                .await
                .unwrap(),
            1
        );
        sqlx::query("UPDATE _sqlx_migrations SET checksum=x'0102' WHERE version=11")
            .execute(&db)
            .await
            .unwrap();
        assert!(matches!(
            run(&db).await,
            Err(MigrateError::VersionMismatch(11))
        ));
        sqlx::query("UPDATE _sqlx_migrations SET checksum=?,success=0 WHERE version=11")
            .bind(hex::decode(APPROVED[0].1).unwrap())
            .execute(&db)
            .await
            .unwrap();
        assert!(run(&db).await.is_err());
    }
}
