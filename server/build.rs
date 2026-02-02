use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=../orchestrator/migrations");

    let out_dir = env::var("OUT_DIR").unwrap();
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let workspace_root = Path::new(&manifest_dir).parent().unwrap();

    // Embed migrations directory into the binary
    let migrations_dir = workspace_root.join("orchestrator").join("migrations");
    if !migrations_dir.exists() {
        panic!("Migrations directory not found: {:?}", migrations_dir);
    }

    // Read all migration files
    let mut entries: Vec<_> = fs::read_dir(&migrations_dir)
        .expect("Failed to read migrations directory")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "sql"))
        .collect();

    entries.sort_by_key(|e| e.file_name());

    // Generate a Rust file with embedded migrations using include_str!
    let migrations_rs = Path::new(&out_dir).join("migrations.rs");
    let mut migrations_file =
        fs::File::create(&migrations_rs).expect("Failed to create migrations.rs");

    writeln!(migrations_file, "use std::collections::HashMap;").unwrap();
    writeln!(migrations_file).unwrap();

    // Generate include_str! for each migration
    for (idx, entry) in entries.iter().enumerate() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let abs_path = fs::canonicalize(&path).unwrap_or_else(|_| {
            panic!("Failed to canonicalize: {:?}", path);
        });
        let path_str = abs_path.to_string_lossy().replace('\\', "/");

        let const_name = format!("MIGRATION_{}", idx);

        writeln!(migrations_file, "// Migration: {}", name).unwrap();
        writeln!(
            migrations_file,
            "const {}: &str = include_str!(r#\"{}\"#);",
            const_name, path_str
        )
        .unwrap();
        writeln!(migrations_file).unwrap();
    }

    writeln!(
        migrations_file,
        "pub fn get_embedded_migrations() -> HashMap<String, String> {{"
    )
    .unwrap();
    writeln!(migrations_file, "    let mut migrations = HashMap::new();").unwrap();

    for (idx, entry) in entries.iter().enumerate() {
        let name = entry.file_name().to_string_lossy().to_string();
        let const_name = format!("MIGRATION_{}", idx);
        writeln!(
            migrations_file,
            "    migrations.insert(\"{}\".to_string(), {}.to_string());",
            name, const_name
        )
        .unwrap();
    }

    writeln!(migrations_file, "    migrations").unwrap();
    writeln!(migrations_file, "}}").unwrap();
}
