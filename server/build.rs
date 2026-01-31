use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../orchestrator/Cargo.toml");
    println!("cargo:rerun-if-changed=../orchestrator/src");
    println!("cargo:rerun-if-changed=../orchestrator/migrations");
    println!("cargo:rerun-if-changed=../ui/dist");

    let out_dir = env::var("OUT_DIR").unwrap();
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let workspace_root = Path::new(&manifest_dir).parent().unwrap();

    // Build orchestrator binary
    let orchestrator_dir = workspace_root.join("orchestrator");
    let orchestrator_target = env::var("TARGET").unwrap();
    let binary_name = if cfg!(target_os = "windows") {
        "polos-orchestrator.exe"
    } else {
        "polos-orchestrator"
    };

    // Check for orchestrator binary in multiple possible locations
    // 1. Orchestrator's own target directory (when built separately, no target specified)
    let orchestrator_binary_own = orchestrator_dir
        .join("target")
        .join("release")
        .join(binary_name);

    // 2. Orchestrator's own target directory with specific target (when built with --target)
    let orchestrator_binary_own_targeted = orchestrator_dir
        .join("target")
        .join(&orchestrator_target)
        .join("release")
        .join(binary_name);

    // 3. Workspace target directory (when built with CARGO_TARGET_DIR set)
    let orchestrator_binary_workspace = workspace_root
        .join("target")
        .join(&orchestrator_target)
        .join("release")
        .join(binary_name);

    // Find which binary exists (prefer orchestrator's own target)
    let existing_binary = if orchestrator_binary_own_targeted.exists() {
        Some(orchestrator_binary_own_targeted.clone())
    } else if orchestrator_binary_own.exists() {
        Some(orchestrator_binary_own.clone())
    } else if orchestrator_binary_workspace.exists() {
        Some(orchestrator_binary_workspace.clone())
    } else {
        None
    };

    // Check if binary already exists and is newer than source files
    let needs_rebuild = if let Some(ref binary_path) = existing_binary {
        // Check if Cargo.toml is newer than the binary
        let binary_metadata = fs::metadata(binary_path).ok();
        let binary_mtime = binary_metadata
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        let cargo_toml = orchestrator_dir.join("Cargo.toml");
        let cargo_toml_mtime = fs::metadata(&cargo_toml)
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        cargo_toml_mtime > binary_mtime
    } else {
        true
    };

    // Determine where to place the binary (use workspace target for new builds)
    let target_binary = workspace_root
        .join("target")
        .join(&orchestrator_target)
        .join("release")
        .join(binary_name);

    if needs_rebuild {
        println!("Building orchestrator for target: {}", orchestrator_target);

        let build_output = Command::new("cargo")
            .args(["build", "--release", "--bin", "polos-orchestrator"])
            .current_dir(&orchestrator_dir)
            .env("CARGO_TARGET_DIR", workspace_root.join("target"))
            .output()
            .expect("Failed to execute cargo build");

        if !build_output.status.success() {
            eprintln!("Orchestrator build failed. Stderr:");
            eprintln!("{}", String::from_utf8_lossy(&build_output.stderr));
            eprintln!("\nStdout:");
            eprintln!("{}", String::from_utf8_lossy(&build_output.stdout));
            panic!(
                "Failed to build orchestrator.\n\
                If you've already built it separately, ensure it exists at one of:\n\
                  - {:?}\n\
                  - {:?}\n\
                Then rebuild the server.",
                orchestrator_binary_own, orchestrator_binary_workspace
            );
        }
    } else if let Some(ref binary_path) = existing_binary {
        println!("Using existing orchestrator binary: {:?}", binary_path);
    }

    // Find the final binary location (could be in any of these locations)
    let orchestrator_binary = if target_binary.exists() {
        target_binary
    } else if orchestrator_binary_own_targeted.exists() {
        orchestrator_binary_own_targeted
    } else if orchestrator_binary_own.exists() {
        orchestrator_binary_own
    } else if orchestrator_binary_workspace.exists() {
        orchestrator_binary_workspace
    } else {
        panic!(
            "Orchestrator binary not found. Expected locations:\n  - {:?}\n  - {:?}\n  - {:?}\n\nPlease build the orchestrator first:\n  cd orchestrator && cargo build --release",
            orchestrator_binary_own_targeted,
            orchestrator_binary_own,
            orchestrator_binary_workspace
        );
    };

    // Copy orchestrator binary to OUT_DIR
    let orchestrator_out = Path::new(&out_dir).join("polos-orchestrator");
    fs::copy(&orchestrator_binary, &orchestrator_out).expect("Failed to copy orchestrator binary");

    println!(
        "cargo:rustc-env=ORCHESTRATOR_BINARY_PATH={}",
        orchestrator_out.display()
    );

    // Check if UI dist directory exists
    let ui_dist = workspace_root.join("ui").join("dist");
    if !ui_dist.exists() {
        println!("cargo:warning=UI dist directory not found. Building UI...");

        // Try to build UI with VITE_POLOS_LOCAL_MODE=true for local development
        let mut build_ui_cmd = Command::new("npm");
        build_ui_cmd
            .args(["run", "build"])
            .current_dir(workspace_root.join("ui"))
            .env("VITE_POLOS_LOCAL_MODE", "true");
        let build_ui_status = build_ui_cmd.status();

        if let Ok(status) = build_ui_status {
            if !status.success() {
                println!(
                    "cargo:warning=Failed to build UI. Server will work but UI won't be available."
                );
            }
        } else {
            println!("cargo:warning=npm not found. UI won't be available.");
        }
    }

    if ui_dist.exists() {
        println!("cargo:rustc-env=UI_DIST_PATH={}", ui_dist.display());
    } else {
        println!("cargo:warning=UI dist directory not found. UI will not be available.");
    }

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
    // We create constants with sanitized names (for valid Rust identifiers)
    // but preserve the original filename for the HashMap key
    for (idx, entry) in entries.iter().enumerate() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        // Convert to absolute path and normalize separators for include_str!
        let abs_path = fs::canonicalize(&path).unwrap_or_else(|_| {
            panic!("Failed to canonicalize: {:?}", path);
        });
        let path_str = abs_path.to_string_lossy().replace('\\', "/");

        // Create a safe constant name: MIGRATION_0, MIGRATION_1, etc.
        // This avoids any issues with special characters in filenames
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

    // Map original filenames to their constants
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
