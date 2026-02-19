use anyhow::{Context, Result};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::fs;
use std::path::PathBuf;

pub async fn ensure_database_exists(database_url: &str) -> Result<()> {
    // Parse database URL to get connection info
    // Format: postgres://user:password@host:port/database
    let url = database_url
        .parse::<url::Url>()
        .context("Invalid DATABASE_URL format")?;

    let host = url.host_str().context("Missing host in DATABASE_URL")?;
    let port = url.port().unwrap_or(5432);
    let user = url.username();
    let password = url.password().unwrap_or("");
    let db_name = url.path().trim_start_matches('/');

    tracing::info!(
        "Connecting to Postgre DB as user '{}' on {}:{}",
        user,
        host,
        port
    );

    // Connect to postgres database (default database)
    let postgres_url = format!(
        "postgres://{}:{}@{}:{}/postgres",
        user, password, host, port
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&postgres_url)
        .await
        .context(format!(
            "Failed to connect to Postgres DB as user '{}'. Make sure Postgres is running and the user has proper permissions.",
            user
        ))?;

    // Check if database exists
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)")
            .bind(db_name)
            .fetch_one(&pool)
            .await?;

    if !exists {
        // Create database
        tracing::info!("Creating database '{}' as user '{}'...", db_name, user);
        sqlx::query(&format!("CREATE DATABASE {}", db_name))
            .execute(&pool)
            .await
            .with_context(|| {
                format!(
                    "Failed to create database '{}' as user '{}'. The user may need CREATEDB privilege. Run: ALTER USER {} CREATEDB;",
                    db_name,
                    user,
                    user
                )
            })?;
        tracing::info!("Created database: {}", db_name);
    } else {
        tracing::info!("Database already exists: {}", db_name);
    }

    Ok(())
}

pub async fn run_migrations(database_url: &str) -> Result<()> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(database_url)
        .await
        .context("Failed to connect to database")?;

    // Get migrations - use embedded migrations from binary
    // Allow override via POLOS_MIGRATIONS_DIR for development
    let migrations: std::collections::HashMap<String, String> =
        if let Ok(env_dir) = std::env::var("POLOS_MIGRATIONS_DIR") {
            // Environment variable override (for development)
            let migrations_dir = PathBuf::from(env_dir);
            if !migrations_dir.exists() {
                anyhow::bail!("Migrations directory not found: {:?}", migrations_dir);
            }

            // Read migrations from directory
            let mut migrations = std::collections::HashMap::new();
            let mut entries: Vec<_> = fs::read_dir(&migrations_dir)?
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().is_some_and(|ext| ext == "sql"))
                .collect();
            entries.sort_by_key(|e| e.file_name());

            for entry in entries {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let content = fs::read_to_string(&path)
                    .with_context(|| format!("Failed to read migration: {:?}", path))?;
                migrations.insert(name, content);
            }
            migrations
        } else {
            // Use embedded migrations from binary
            let embedded = crate::migrations::get_embedded_migrations();
            embedded
                .into_iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        };

    // Extract migrations to a temporary directory and use sqlx Migrator
    // This ensures proper handling of multi-statement migrations, sequences, etc.
    let temp_migrations_dir =
        std::env::temp_dir().join(format!("polos-migrations-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_migrations_dir)
        .context("Failed to create temporary migrations directory")?;

    // Write migration files to temp directory in sorted order
    let mut migration_names: Vec<_> = migrations.keys().collect();
    migration_names.sort();

    for migration_name in &migration_names {
        let sql = migrations
            .get(*migration_name)
            .context(format!("Migration {} not found", migration_name))?;

        let migration_path = temp_migrations_dir.join(migration_name);
        fs::write(&migration_path, sql)
            .with_context(|| format!("Failed to write migration file: {:?}", migration_path))?;
    }

    // Use sqlx Migrator to run migrations
    // This properly handles multi-statement migrations, transactions, sequences, etc.
    let migrator = sqlx::migrate::Migrator::new(temp_migrations_dir.clone())
        .await
        .context("Failed to create sqlx Migrator")?;

    migrator
        .run(&pool)
        .await
        .context("Failed to run migrations")?;

    // Clean up temp directory
    let _ = fs::remove_dir_all(&temp_migrations_dir);

    tracing::info!("Migrations completed");
    Ok(())
}

pub async fn get_database_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(database_url)
        .await
        .context("Failed to connect to database")?;
    Ok(pool)
}
