// Embedded migrations - generated at build time
include!(concat!(env!("OUT_DIR"), "/migrations.rs"));
